import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express, { type Express, type Request, type RequestHandler, type Response } from 'express';
import type { Logger } from 'pino';
import type { Db } from './db/client.js';
import type { Mailer } from './lib/mailer.js';
import { csrfProtection, loadSession, requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { httpLogger } from './middleware/logger.js';
import {
  createRateLimiters,
  DEFAULT_RATE_LIMITS,
  type RateLimitConfig,
} from './middleware/rate-limit.js';
import { requestId } from './middleware/request-id.js';
import { noStore, originCheck, securityHeaders } from './middleware/security.js';
import { authRouter } from './modules/auth/routes.js';
import { cookieSettings } from './modules/auth/session.js';
import { contactsRouter } from './modules/contacts/routes.js';
import { dealsRouter } from './modules/deals/routes.js';
import { salesRouter } from './modules/sales/routes.js';
import { healthRouter } from './modules/health/routes.js';
import { invitationsRouter } from './modules/invitations/routes.js';
import { teamRouter } from './modules/team/routes.js';
import { clientOrgsRouter } from './modules/client-orgs/routes.js';
import { portalRouter } from './modules/portal/routes.js';
import { proposalsRouter } from './modules/proposals/routes.js';
import { servicesRouter } from './modules/services/routes.js';
import { insightsRouter } from './modules/insights/routes.js';
import { projectsRouter } from './modules/projects/routes.js';

export interface AppConfig {
  isProduction: boolean;
  appOrigins: string[];
  csrfSecret: string;
  trustProxy: number;
  /** Base URL for links in emails, e.g. https://app.example.com (no trailing slash). */
  publicUrl: string;
  rateLimits?: Partial<RateLimitConfig>;
  /** Built web app (apps/web/dist). When set, this process serves it on the same origin. */
  webDistDir?: string;
}

export interface AppDeps {
  db: Db;
  logger: Logger;
  config: AppConfig;
  mailer: Mailer;
  /** Test-only fault injection (T-HAND-02). Never set by server.ts. */
  hooks?: { beforeHandoffCommit?: () => void | Promise<void> };
  /** Receives work that continues after a response is sent (tests await it). */
  background?: (work: Promise<unknown>) => void;
}

/** Builds the Express app. Pipeline: route → auth → validation → policy → service (spec §11.3). */
export function createApp(deps: AppDeps): Express {
  const { db, logger, config } = deps;
  const cookies = cookieSettings(config.isProduction);
  const limiters = createRateLimiters({ ...DEFAULT_RATE_LIMITS, ...config.rateLimits });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('query parser', 'simple');

  app.use(requestId);
  app.use(httpLogger(logger));
  const apiHeaders = securityHeaders(config.isProduction, 'api');
  app.use('/health', apiHeaders, healthRouter(db));

  const api = express.Router();
  api.use(noStore);
  api.use(limiters.api);
  api.use(originCheck(config.appOrigins));
  api.use(express.json({ limit: '32kb', strict: true }));
  api.use(cookieParser());
  api.use(loadSession(db, cookies));
  api.use(csrfProtection(config.csrfSecret));

  api.use('/auth', authRouter(deps, limiters));
  api.use('/contacts', contactsRouter(deps));
  api.use('/deals', dealsRouter(deps));
  api.use('/invitations', invitationsRouter(deps, limiters));
  api.use('/users', requireAuth, teamRouter(deps));
  api.use('/proposals', proposalsRouter(deps));
  api.use('/services', servicesRouter(deps));
  api.use('/portal', portalRouter(deps));
  api.use(salesRouter(deps));
  api.use(clientOrgsRouter(deps));
  api.use(insightsRouter(deps));
  api.use(projectsRouter(deps));
  api.use(notFoundHandler);

  app.use('/api/v1', apiHeaders, api);
  if (config.webDistDir) app.use(webApp(config.webDistDir, config.isProduction));
  app.use(apiHeaders, notFoundHandler);
  app.use(errorHandler);
  return app;
}

/**
 * Serves the built single-page app (production, ADR-034). Hashed assets are cached for a year;
 * index.html is never cached so a deploy takes effect at once. Unknown non-API paths get
 * index.html and the client router decides; /api and /health keep their JSON 404s.
 */
function webApp(dir: string, isProduction: boolean): RequestHandler {
  const root = resolve(dir);
  const index = join(root, 'index.html');
  if (!existsSync(index)) throw new Error(`WEB_DIST_DIR has no index.html: ${root}`);
  const router = express.Router();
  router.use(securityHeaders(isProduction, 'web'));
  router.use(
    '/assets',
    express.static(join(root, 'assets'), { immutable: true, maxAge: '365d', index: false }),
    // A missing hashed asset is a 404, not the SPA page (and not an error).
    (_req: Request, res: Response) => {
      res.status(404).type('text/plain').send('Not found');
    },
  );
  router.use(express.static(root, { index: false, maxAge: 0 }));
  router.get(/^\/(?!api\/|health\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  return router;
}
