import type { Role } from '@clientflow/contracts';

export interface AuthUser {
  id: string;
  agencyId: string;
  name: string;
  emailNorm: string;
  role: Role;
  /** CLIENT users only. Portal queries are always filtered by it. */
  clientOrgId: string | null;
}

export interface AuthContext {
  sessionId: string;
  sessionTokenHash: string;
  user: AuthUser;
  agency: { id: string; name: string; defaultCurrency: string; timezone: string };
  clientOrg: { id: string; name: string } | null;
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
    }
  }
}

export {};
