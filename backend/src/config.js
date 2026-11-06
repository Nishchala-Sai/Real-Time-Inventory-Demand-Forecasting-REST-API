import { z } from 'zod';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65535).default(4000),
    MONGODB_URI: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    ACCESS_TOKEN_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL: z.string().default('7d'),
    APP_ORIGIN: z.url(),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((list) => list.split(',').map((origin) => origin.trim()).filter(Boolean)),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    STORE_TZ: z.string().default('UTC').refine(isTimeZone, 'must be an IANA time zone'),
    SSE_MAX_CLIENTS: z.coerce.number().int().min(1).default(500),
    LOG_LEVEL: z.string().default('info'),
    ADMIN_EMAIL: z.email().optional(),
    ADMIN_PASSWORD: z.string().min(12).max(128).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'must differ from JWT_ACCESS_SECRET' });
    }
    if (env.NODE_ENV === 'production' && !isSecureOrigin(env.APP_ORIGIN)) {
      ctx.addIssue({ code: 'custom', path: ['APP_ORIGIN'], message: 'must be https in production' });
    }
  });

function isTimeZone(zone) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// Browsers treat loopback as a secure context, so the local compose stack can run in
// production mode over plain http without weakening a real deployment.
function isSecureOrigin(origin) {
  const { protocol, hostname } = new URL(origin);
  return protocol === 'https:' || LOOPBACK.has(hostname);
}

export function parseConfig(env) {
  const result = schema.safeParse(env);
  if (result.success) return result.data;
  const lines = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`Invalid environment:\n${lines.join('\n')}`);
}

function load() {
  try {
    return parseConfig(process.env);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

export const config = load();
