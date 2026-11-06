import { ApiError } from '../lib/errors.js';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function originCheck({ appOrigin, corsOrigins }) {
  const allowed = new Set([appOrigin, ...corsOrigins]);
  const crossOrigin = new Set(corsOrigins);

  return (req, res, next) => {
    const origin = req.get('origin');

    if (origin && crossOrigin.has(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
      res.vary('Origin');
      if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE');
        res.set('Access-Control-Allow-Headers', 'Content-Type,Idempotency-Key,X-Request-Id');
        return res.sendStatus(204);
      }
    }

    if (!MUTATING.has(req.method)) return next();
    if (origin && !allowed.has(origin)) return next(new ApiError('FORBIDDEN', 'Origin not allowed'));
    // Cross-site HTML forms cannot send this type, so requiring it closes the CSRF route they open.
    if (!req.get('content-type')?.startsWith('application/json')) {
      return next(new ApiError('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json'));
    }
    next();
  };
}
