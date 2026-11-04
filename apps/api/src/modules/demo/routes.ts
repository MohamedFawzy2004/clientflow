// "Explore as …" sign-in for the public demo (ADR-071). Mounted only when DEMO_MODE=true, so on any
// other deployment these paths are plain 404s. No password is published: the visitor picks a role
// and gets an ordinary session as the fictional person who holds it.
import { Router, type RequestHandler } from 'express';
import {
  ROLES,
  demoSessionRequestSchema,
  type DemoAccount,
  type Role,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { AppError } from '../../lib/errors.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requireFormCsrf } from '../../middleware/auth.js';
import { cookieSettings } from '../auth/session.js';
import { signIn } from '../auth/sign-in.js';

/** The person each role signs in as: the first active one, so the choice is stable. */
async function demoPeople(db: AppDeps['db']) {
  const users = await db.user.findMany({
    where: { active: true, agency: { isDemo: true } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { agency: true },
  });
  const byRole = new Map<Role, (typeof users)[number]>();
  for (const u of users) if (!byRole.has(u.role)) byRole.set(u.role, u);
  return byRole;
}

export function demoRouter(deps: AppDeps, limiters: { loginPerIp: RequestHandler }) {
  const { db, config } = deps;
  const formCsrf = requireFormCsrf(config.csrfSecret, cookieSettings(config.isProduction));
  const router = Router();

  router.get('/accounts', async (req, res, next) => {
    try {
      const people = await demoPeople(db);
      const accounts: DemoAccount[] = ROLES.filter((r) => people.has(r)).map((role) => ({
        role,
        name: people.get(role)!.name,
      }));
      res.json({ data: accounts, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/sessions', limiters.loginPerIp, formCsrf, async (req, res, next) => {
    try {
      const { role } = parseOrThrow(demoSessionRequestSchema, req.body);
      const user = (await demoPeople(db)).get(role);
      // Only a demo agency's people, never a real workspace's (the query is limited to isDemo).
      if (!user) throw new AppError(404, 'NOT_FOUND', 'The demo has nobody with that role.');
      const body = await signIn(deps, req, res, user, 'auth.login');
      res.json({ data: body, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
