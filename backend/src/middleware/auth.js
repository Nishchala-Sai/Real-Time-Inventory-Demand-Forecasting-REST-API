import { ApiError } from '../lib/errors.js';
import { verifyAccess } from '../lib/tokens.js';

// With no roles, any signed-in user passes.
export function requireRole(...roles) {
  return (req, res, next) => {
    let claims;
    try {
      claims = verifyAccess(req.cookies?.at);
    } catch {
      return next(new ApiError('UNAUTHENTICATED', 'Sign in to continue'));
    }
    req.user = { id: claims.sub, role: claims.role, supplierId: claims.sid ?? null };
    if (roles.length > 0 && !roles.includes(claims.role)) {
      return next(new ApiError('FORBIDDEN', 'You do not have access to this'));
    }
    next();
  };
}
