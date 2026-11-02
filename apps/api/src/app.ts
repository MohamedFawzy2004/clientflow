import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import type { Logger } from 'pino';
import type { Db } from './db/client.js';
import { csrfProtection, loadSession } from './middleware/auth.js';
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
import { healthRouter } from './modules/health/routes.js';

export interface AppConfig {
  isProduction: boolean;
  appOrigins: string[];
  csrfSecret: string;
  trustProxy: number;
  rateLimits?: Partial<RateLimitConfig>;
}

export interface AppDeps {
  db: Db;
  logger: Logger;
  config: AppConfig;
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
  app.use(securityHeaders(config.isProduction));

  app.use('/health', healthRouter(db));

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
  api.use(notFoundHandler);

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
