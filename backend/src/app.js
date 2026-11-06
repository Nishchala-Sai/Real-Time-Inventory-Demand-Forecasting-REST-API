import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFound } from './middleware/error.js';
import { originCheck } from './middleware/origin.js';
import { globalLimit } from './middleware/rateLimits.js';
import { healthRoutes } from './routes/health.js';

const REQUEST_ID = /^[\w-]{1,64}$/;
const FRONTEND_DIST = fileURLToPath(new URL('../../frontend/dist', import.meta.url));

function requestId(req, res) {
  const inbound = req.get('x-request-id');
  const id = inbound && REQUEST_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

export function createApp() {
  const app = express();

  app.use(
    pinoHttp({
      logger,
      genReqId: requestId,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.set('trust proxy', config.TRUST_PROXY);
  app.use('/api', globalLimit);
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());
  app.use(originCheck({ appOrigin: config.APP_ORIGIN, corsOrigins: config.CORS_ORIGINS }));

  app.use('/api/v1', healthRoutes);

  if (config.NODE_ENV === 'production') {
    app.use(express.static(FRONTEND_DIST));
    app.get(/^(?!\/api(\/|$))/, (req, res) => res.sendFile('index.html', { root: FRONTEND_DIST }));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
