import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { ApiError } from '../lib/errors.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const PROBES = new Set(['/api/v1/health', '/api/v1/ready']);

const limiter = (options) =>
  rateLimit({
    standardHeaders: 'draft-6',
    legacyHeaders: false,
    handler: (req, res, next) => next(new ApiError('RATE_LIMITED', 'Too many requests, try again later')),
    ...options,
  });

export const globalLimit = limiter({
  windowMs: FIFTEEN_MINUTES,
  limit: 300,
  skip: (req) => PROBES.has(req.originalUrl),
});

// Only failed logins count, so a shared office IP is not locked out by its own successes.
export const loginIpLimit = limiter({
  windowMs: FIFTEEN_MINUTES,
  limit: 50,
  skipSuccessfulRequests: true,
});

export const loginAccountLimit = limiter({
  windowMs: FIFTEEN_MINUTES,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email).toLowerCase()}`,
});

export const writeLimit = limiter({
  windowMs: 60 * 1000,
  limit: 120,
  keyGenerator: (req) => req.user.id,
});
