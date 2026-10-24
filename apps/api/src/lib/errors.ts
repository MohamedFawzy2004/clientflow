import type { ErrorCode } from '@clientflow/contracts';

/** An error that is safe to show to the client. Everything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthenticated = () =>
  new AppError(401, 'UNAUTHENTICATED', 'Your session has ended. Sign in to continue.');

export const forbidden = (message = 'You do not have permission to do that.') =>
  new AppError(403, 'FORBIDDEN', message);

/** Used for missing AND out-of-scope records, so the two cannot be told apart (spec §6.2). */
export const notFound = () => new AppError(404, 'NOT_FOUND', 'We could not find that record.');

export const csrfInvalid = () =>
  new AppError(403, 'CSRF_INVALID', 'Your security token expired. Refresh the page and try again.');

export const validationFailed = (fieldErrors: Record<string, string[]>) =>
  new AppError(422, 'VALIDATION_FAILED', 'Some fields need your attention.', fieldErrors);

/** Business-rule conflict, e.g. removing the last owner or inviting an existing member. */
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);

export const staleVersion = () =>
  new AppError(
    409,
    'CONFLICT_STALE_VERSION',
    'This record changed since you opened it. Refresh to see the latest version.',
  );

/** Same message for unknown, used, expired and revoked links, so they cannot be told apart. */
export const tokenInvalid = (what: 'invitation' | 'reset') =>
  new AppError(
    400,
    'TOKEN_INVALID',
    what === 'invitation'
      ? 'This invitation link is invalid or has expired. Ask your admin for a new one.'
      : 'This reset link is invalid or has expired. Request a new one.',
  );
