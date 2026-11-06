import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const ALGORITHM = 'HS256';
const AUTH_PATH = '/api/v1/auth';

function signAccess(user) {
  const claims = { role: user.role, ...(user.supplierId ? { sid: String(user.supplierId) } : {}) };
  return jwt.sign(claims, config.JWT_ACCESS_SECRET, {
    subject: String(user._id),
    algorithm: ALGORITHM,
    expiresIn: config.ACCESS_TOKEN_TTL,
  });
}

function signRefresh(user) {
  // The random ID keeps two refreshes within the same second from producing the same token.
  return jwt.sign({ tv: user.tokenVersion, jti: randomUUID() }, config.JWT_REFRESH_SECRET, {
    subject: String(user._id),
    algorithm: ALGORITHM,
    expiresIn: config.REFRESH_TOKEN_TTL,
  });
}

export function verifyAccess(token) {
  return jwt.verify(token, config.JWT_ACCESS_SECRET, { algorithms: [ALGORITHM] });
}

export function verifyRefresh(token) {
  return jwt.verify(token, config.JWT_REFRESH_SECRET, { algorithms: [ALGORITHM] });
}

const cookieOptions = (path) => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: config.NODE_ENV === 'production',
  path,
});

function setCookie(res, name, token, path) {
  const expires = new Date(jwt.decode(token).exp * 1000);
  res.cookie(name, token, { ...cookieOptions(path), expires });
}

export function setAuthCookies(res, user) {
  setCookie(res, 'at', signAccess(user), '/');
  setCookie(res, 'rt', signRefresh(user), AUTH_PATH);
}

export function clearAuthCookies(res) {
  res.clearCookie('at', cookieOptions('/'));
  res.clearCookie('rt', cookieOptions(AUTH_PATH));
}
