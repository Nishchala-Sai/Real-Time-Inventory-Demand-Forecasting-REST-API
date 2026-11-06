import { z } from 'zod';
import { ApiError } from '../lib/errors.js';

export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id');
export const limit = z.coerce.number().int().min(1).max(100).default(50);
export const email = z.string().trim().toLowerCase().pipe(z.email());

// Express 5 makes req.query a getter, so parsed values live on req.valid everywhere.
export function validate({ params, query, body } = {}) {
  return (req, res, next) => {
    req.valid = {};
    const issues = [];
    for (const [part, schema, input] of [
      ['params', params, req.params],
      ['query', query, req.query],
      ['body', body, req.body ?? {}],
    ]) {
      if (!schema) continue;
      const result = schema.safeParse(input);
      if (result.success) req.valid[part] = result.data;
      else {
        issues.push(
          ...result.error.issues.map((issue) => ({
            path: [part, ...issue.path].join('.'),
            message: issue.message,
          })),
        );
      }
    }
    if (issues.length > 0) return next(new ApiError('VALIDATION_ERROR', 'Request failed validation', issues));
    next();
  };
}
