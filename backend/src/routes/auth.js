import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { clearAuthCookies, setAuthCookies, verifyRefresh } from '../lib/tokens.js';
import { userView } from '../lib/views.js';
import { requireRole } from '../middleware/auth.js';
import { loginAccountLimit, loginIpLimit } from '../middleware/rateLimits.js';
import { email, validate } from '../middleware/validate.js';
import { User } from '../models/User.js';

// Verifying against this when the email is unknown keeps response time from revealing who has an account.
const dummyHash = hashPassword(randomUUID());

const loginBody = z.strictObject({ email, password: z.string().min(1).max(128) });

export const authRoutes = Router();

authRoutes.post('/auth/login', loginIpLimit, loginAccountLimit, validate({ body: loginBody }), async (req, res) => {
  const { email: address, password } = req.valid.body;
  const user = await User.findOne({ email: address }).select('+passwordHash');
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || user.disabled || !passwordOk) {
    throw new ApiError('UNAUTHENTICATED', 'Invalid email or password');
  }
  setAuthCookies(res, user);
  res.json({ user: userView(user) });
});

authRoutes.post('/auth/refresh', async (req, res) => {
  const invalid = new ApiError('UNAUTHENTICATED', 'Sign in to continue');
  let claims;
  try {
    claims = verifyRefresh(req.cookies?.rt);
  } catch {
    throw invalid;
  }
  const user = await User.findById(claims.sub);
  if (!user || user.disabled || claims.tv !== user.tokenVersion) throw invalid;
  setAuthCookies(res, user);
  res.json({ user: userView(user) });
});

authRoutes.post('/auth/logout', requireRole(), async (req, res) => {
  await User.updateOne({ _id: req.user.id }, { $inc: { tokenVersion: 1 } });
  clearAuthCookies(res);
  res.status(204).end();
});

authRoutes.get('/auth/me', requireRole(), async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user || user.disabled) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
  res.json({ user: userView(user) });
});
