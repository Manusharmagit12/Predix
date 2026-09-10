'use strict';
/**
 * Auth — password hashing (scrypt), sessions, cookies, promo codes.
 * Sessions are opaque random tokens stored server-side (revocable), sent as an
 * httpOnly cookie. Passwords are salted scrypt hashes.
 */
const crypto = require('crypto');

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days
const COOKIE_NAME = 'predix_session';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expected) {
  try {
    const got = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    const exp = Buffer.from(expected, 'hex');
    return got.length === exp.length && crypto.timingSafeEqual(got, exp);
  } catch { return false; }
}

class Auth {
  constructor(db) { this.db = db; }

  /* ---------- sessions ---------- */

  createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    this.db.insert('sessions', { token, userId, createdAt: now, expiresAt: now + SESSION_TTL_MS });
    return token;
  }

  destroySession(token) {
    const s = this.db.findOne('sessions', (r) => r.token === token);
    if (s) this.db.remove('sessions', s.id);
  }

  userForToken(token) {
    if (!token) return null;
    const s = this.db.findOne('sessions', (r) => r.token === token);
    if (!s || s.expiresAt < Date.now()) return null;
    return this.db.get('users', s.userId);
  }

  /* ---------- cookies ---------- */

  parseCookies(req) {
    const out = {};
    const raw = req.headers.cookie;
    if (!raw) return out;
    for (const part of raw.split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  sessionCookie(token, maxAgeSeconds) {
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
  }

  clearCookie() {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  /* ---------- request user ---------- */

  userForRequest(req) {
    const cookies = this.parseCookies(req);
    return this.userForToken(cookies[COOKIE_NAME]);
  }

  tokenForRequest(req) {
    const cookies = this.parseCookies(req);
    return cookies[COOKIE_NAME] || null;
  }

  /* ---------- signup / login ---------- */

  static validateUsername(u) {
    return typeof u === 'string' && /^[A-Za-z0-9_]{3,24}$/.test(u);
  }
  static validateEmail(e) {
    return typeof e === 'string' && /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,10}$/.test(e);
  }
  static validatePassword(p) {
    return typeof p === 'string' && p.length >= 8 && p.length <= 128;
  }

  signup({ username, email, password }) {
    username = (username || '').trim();
    email = (email || '').trim();
    if (!Auth.validateUsername(username)) throw new ApiError(400, 'Username must be 3–24 characters (letters, numbers, underscore).');
    if (!Auth.validateEmail(email)) throw new ApiError(400, 'Please enter a valid email address.');
    if (!Auth.validatePassword(password)) throw new ApiError(400, 'Password must be at least 8 characters.');
    const lowerName = username.toLowerCase();
    const lowerMail = email.toLowerCase();
    if (this.db.findOne('users', (r) => r.username.toLowerCase() === lowerName)) {
      throw new ApiError(409, 'That username is already taken.');
    }
    if (this.db.findOne('users', (r) => r.email.toLowerCase() === lowerMail)) {
      throw new ApiError(409, 'An account with that email already exists.');
    }
    const { salt, hash } = hashPassword(password);
    const now = Date.now();
    const user = this.db.insert('users', {
      username, email: lowerMail, salt, passHash: hash,
      role: 'user', createdAt: now,
    });
    this.db.insert('wallets', { id: user.id, userId: user.id, available: 0, reserved: 0 });
    return user;
  }

  login(identifier, password) {
    const id = (identifier || '').trim().toLowerCase();
    const user = this.db.findOne('users', (r) => r.username.toLowerCase() === id || r.email.toLowerCase() === id);
    if (!user || !verifyPassword(password || '', user.salt, user.passHash)) {
      throw new ApiError(401, 'Invalid credentials.');
    }
    return user;
  }

  /* ---------- promo codes ---------- */

  lookupPromo(code) {
    const c = String(code || '').trim().toUpperCase();
    if (!c) return null;
    return this.db.findOne('promos', (r) => r.code === c && r.active);
  }

  redeemPromo(user, code) {
    const promo = this.lookupPromo(code);
    if (!promo) throw new ApiError(404, 'Invalid or expired promo code.');
    const already = this.db.findOne('redemptions', (r) => r.userId === user.id && r.code === promo.code);
    if (already) throw new ApiError(409, 'You have already redeemed this code.');
    return { promo, apply: (walletFn) => walletFn(promo.amount, promo.code, promo.label) };
  }
}

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
Auth.ApiError = ApiError;

module.exports = { Auth, ApiError, SESSION_TTL_MS, COOKIE_NAME, hashPassword, verifyPassword };
