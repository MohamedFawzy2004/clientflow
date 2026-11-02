import type { Role } from '@clientflow/contracts';

export interface AuthUser {
  id: string;
  agencyId: string;
  name: string;
  emailNorm: string;
  role: Role;
}

export interface AuthContext {
  sessionId: string;
  sessionTokenHash: string;
  user: AuthUser;
  agency: { id: string; name: string; defaultCurrency: string; timezone: string };
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
