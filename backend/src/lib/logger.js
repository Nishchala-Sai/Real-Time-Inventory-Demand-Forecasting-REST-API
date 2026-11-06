import pino from 'pino';
import { config } from '../config.js';

const isDev = config.NODE_ENV === 'development';

export const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
  transport: isDev ? { target: 'pino-pretty' } : undefined,
});
