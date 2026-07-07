import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { all, first, run, now } from './db';
import { isAdmin, type App, type User, type UserRole } from './types';

const SESSION_COOKIE = 'vt_session';
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100_000;

const hex = (buf: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

async function sha256hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256
  );
  return hex(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${hex(salt)}:${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterStr, saltHex, expected] = stored.split(':');
  if (scheme !== 'pbkdf2' || !iterStr || !saltHex || !expected) return false;
  const salt = new Uint8Array(saltHex.match(/../g)!.map((b) => parseInt(b, 16)));
  const actual = await pbkdf2(password, salt, parseInt(iterStr, 10));
  // Constant-time comparison
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function createSession(db: D1Database, userId: string): Promise<string> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await run(db, 'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    await sha256hex(token), userId, expires, now());
  return token;
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: new URL(c.req.url).protocol === 'https:',
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function destroySession(c: Context, db: D1Database) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await run(db, 'DELETE FROM sessions WHERE token_hash = ?', await sha256hex(token));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export async function setImpersonation(db: D1Database, tokenHash: string, targetId: string | null) {
  await run(db, 'UPDATE sessions SET impersonating_id = ? WHERE token_hash = ?', targetId, tokenHash);
}

/** True when the users table is empty, i.e. first-run setup is needed. */
export async function needsSetup(db: D1Database): Promise<boolean> {
  const row = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM users');
  return !row || row.n === 0;
}

/**
 * Loads the session and attaches `user` (effective, possibly impersonated) and
 * `realUser` to the context. Redirects to /login (or /setup on first run) when
 * unauthenticated. Also rejects cross-origin POSTs (CSRF).
 */
export const requireAuth = createMiddleware<App>(async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.req.url).origin) return c.text('Cross-origin request rejected', 403);
  }

  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const tokenHash = await sha256hex(token);
    const session = await first<{ user_id: string; impersonating_id: string | null }>(
      c.env.DB, 'SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?', tokenHash, now());
    if (session) {
      const realUser = await first<User>(c.env.DB, 'SELECT * FROM users WHERE id = ? AND is_active = 1', session.user_id);
      if (realUser) {
        let user = realUser;
        if (session.impersonating_id && isAdmin(realUser)) {
          const target = await first<User>(c.env.DB, 'SELECT * FROM users WHERE id = ?', session.impersonating_id);
          if (target) user = target;
        }
        c.set('user', user);
        c.set('realUser', realUser);
        c.set('sessionToken', tokenHash);
        return next();
      }
    }
  }

  if (await needsSetup(c.env.DB)) return c.redirect('/setup');
  if (c.req.method !== 'GET') return c.text('Session expired - reload and sign in again', 401);
  const dest = c.req.path === '/' ? '' : `?next=${encodeURIComponent(c.req.path)}`;
  return c.redirect(`/login${dest}`);
});

/** Route guard for role-restricted pages. Checks the REAL user so impersonation cannot escalate. */
export const requireRole = (...roles: UserRole[]) =>
  createMiddleware<App>(async (c, next) => {
    const user = c.get('realUser');
    if (roles.includes(user.role) || (roles.includes('admin') && isAdmin(user))) return next();
    return c.text('Forbidden', 403);
  });

export async function findUserByEmail(db: D1Database, email: string): Promise<User | null> {
  return first<User>(db, 'SELECT * FROM users WHERE email = ? COLLATE NOCASE', email.trim());
}

export async function activeUsers(db: D1Database): Promise<User[]> {
  return all<User>(db, 'SELECT * FROM users WHERE is_active = 1 ORDER BY full_name');
}

// ---- Flash messages (one-shot toast across a redirect) ----

export function flash(c: Context, message: string, kind: 'ok' | 'err' = 'ok') {
  setCookie(c, 'vt_flash', encodeURIComponent(`${kind}:${message}`), { path: '/', maxAge: 20, sameSite: 'Lax' });
}

export function takeFlash(c: Context): { kind: 'ok' | 'err'; message: string } | null {
  const raw = getCookie(c, 'vt_flash');
  if (!raw) return null;
  deleteCookie(c, 'vt_flash', { path: '/' });
  const value = decodeURIComponent(raw);
  const kind = value.startsWith('err:') ? 'err' : 'ok';
  return { kind, message: value.replace(/^(ok|err):/, '') };
}
