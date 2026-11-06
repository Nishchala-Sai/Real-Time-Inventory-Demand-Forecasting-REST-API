import { ApiError } from '../lib/errors.js';

const MONGO_DUPLICATE_KEY = 11000;

function toApiError(error) {
  if (error instanceof ApiError) return error;
  if (error.type === 'entity.parse.failed') return new ApiError('VALIDATION_ERROR', 'Request body is not valid JSON');
  if (error.type === 'entity.too.large') return new ApiError('VALIDATION_ERROR', 'Request body is too large');
  if (error.code === MONGO_DUPLICATE_KEY) return new ApiError('CONFLICT', 'That value already exists');
  if (error.name === 'ValidationError') return new ApiError('VALIDATION_ERROR', 'Request failed validation');
  return null;
}

export function notFound(req, res, next) {
  next(new ApiError('NOT_FOUND', 'Route not found'));
}

// Express identifies error handlers by their four-argument signature, so `next` must stay.
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, next) {
  const known = toApiError(error);
  if (!known) req.log?.error({ err: error, requestId: req.id }, 'unhandled error');
  const { status, code, message, details } = known ?? new ApiError('INTERNAL', 'Something went wrong');
  res.status(status).json({ error: { code, message, details } });
}
