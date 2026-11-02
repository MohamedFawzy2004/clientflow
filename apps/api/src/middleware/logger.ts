import pino, { type DestinationStream, type Logger } from 'pino';
import { pinoHttp } from 'pino-http';

// Never log credentials, cookies, CSRF tokens or request bodies (T-SEC-05).
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.csrfToken',
];

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      base: { service: 'clientflow-api' },
    },
    destination,
  );
}

export function httpLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: (req) => (req as unknown as Express.Request).requestId,
    customProps: (req) => ({ userId: (req as unknown as Express.Request).auth?.user.id }),
    // Query strings can contain search terms with PII, so only the path is logged.
    serializers: {
      req: (req: {
        id: string;
        method: string;
        url: string;
        headers: Record<string, unknown>;
      }) => ({
        id: req.id,
        method: req.method,
        // Download links carry a signed token in the path: log the route, not the token.
        path: req.url.split('?')[0]!.replace(/(\/files\/download\/)[^/]+/, '$1[REDACTED]'),
        headers: req.headers,
      }),
    },
    customLogLevel: (_req, res, err) =>
      err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  });
}
