// Built-in sign-in, ported from EP Workspace (DECISIONS I5, O4, P2-2, P2-3, F-14):
// PBKDF2-SHA256 passwords (WebCrypto); a signed HttpOnly + SameSite=Lax session cookie with no server-side session
// table (user id, session_epoch, expiry, random session id); raising session_epoch ends every session of that user;
// CSRF token = HMAC of the session id; lockout after N failures; IP throttle per server instance.
import type { AppContext } from '../context.ts';
import { hmac } from '../crypto.ts';
import type { Reply, Req } from '../http.ts';
import type { User } from '../store/types.ts';
import { b64url, fromB64url, nowIso, randomBytes, randomToken, safeEqual } from '../util.ts';
import type { Role } from './capabilities.ts';

export const SESSION_COOKIE = 'ep_session';
export const MIN_PASSWORD = 10;
const IP_WINDOW_MIN = 15;
const IP_MAX_ATTEMPTS = 30;
const LOCK_MINUTES = 15;
/** The Cloudflare Workers maximum, kept so phase 4 can run unchanged. */
export const PBKDF2_ITERATIONS = 100_000;

export interface SessionUser {
  userId: string;
  username: string;
  name: string;
  role: Role;
  csrf: string;
  sessionId: string;
  mustChangePassword: boolean;
  remember: boolean;
}

// ── passwords ──
async function pbkdf2(pw: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256));
}

/** "pbkdf2-sha256$<iterations>$<salt>$<hash>" (base64url). */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(await pbkdf2(pw, salt, PBKDF2_ITERATIONS))}`;
}

export async function verifyPassword(stored: string | null, pw: string): Promise<boolean> {
  const m = /^pbkdf2-sha256\$(\d+)\$([^$]+)\$([^$]+)$/.exec(stored ?? '');
  if (!m) return false;
  const got = b64url(await pbkdf2(pw, fromB64url(m[2]), Number(m[1])));
  return safeEqual(got, m[3]);
}

export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 200) return 'Password is too long.';
  return null;
}

// ── signed session cookie ──
interface Claims {
  u: string; // user id
  e: number; // session epoch
  x: number; // expiry (ms)
  s: string; // session id
  r?: 1; // remember me
}

const sign = (ctx: AppContext, payload: string) => hmac(ctx.env.sessionSecret, 'session/v1', payload);
const csrfFor = (ctx: AppContext, sessionId: string) => hmac(ctx.env.sessionSecret, 'csrf/v1', sessionId);

async function readCookie(ctx: AppContext, token: string | undefined): Promise<Claims | null> {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  if (!safeEqual(await sign(ctx, payload), sig)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Claims;
  } catch {
    return null;
  }
}

/** The signed-in user, or null (bad signature, expired, disabled, or an older session epoch). */
export async function resolveUser(ctx: AppContext, req: Req): Promise<SessionUser | null> {
  const c = await readCookie(ctx, req.cookies[SESSION_COOKIE]);
  if (!c || c.x <= ctx.now().getTime()) return null;
  const u = await ctx.store.getUser(c.u);
  if (!u || u.status !== 'ACTIVE' || u.session_epoch !== c.e) return null;
  return {
    userId: u.user_id,
    username: u.username,
    name: u.display_name,
    role: u.role,
    csrf: await csrfFor(ctx, c.s),
    sessionId: c.s,
    mustChangePassword: u.must_change_password,
    remember: c.r === 1,
  };
}

/** remember = "Keep me signed in" (F-14): the session lasts remember_days instead of session_hours. */
export async function createSession(ctx: AppContext, reply: Reply, user: User, opts: { remember?: boolean } = {}): Promise<string> {
  const hours = opts.remember ? ctx.site.auth.remember_days * 24 : ctx.site.auth.session_hours;
  const claims: Claims = { u: user.user_id, e: user.session_epoch, x: ctx.now().getTime() + hours * 3600_000, s: randomToken(12), ...(opts.remember ? { r: 1 as const } : {}) };
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  reply.setCookie(SESSION_COOKIE, `${payload}.${await sign(ctx, payload)}`, {
    path: '/',
    httpOnly: true,
    secure: ctx.env.secureCookies,
    sameSite: 'lax',
    maxAge: hours * 3600,
  });
  return csrfFor(ctx, claims.s);
}

export function clearSessionCookie(ctx: AppContext, reply: Reply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: ctx.env.secureCookies, sameSite: 'lax' });
}

// ── sign-in ──
export type LoginResult = { ok: true; user: User } | { ok: false; status: number; error: string; message: string };

let timingHash: Promise<string> | null = null;

export async function attemptLogin(ctx: AppContext, ip: string, username: unknown, password: unknown): Promise<LoginResult> {
  const { store, throttle } = ctx;
  const now = ctx.now();
  const pw = String(password ?? '');
  const generic = { ok: false as const, status: 401, error: 'INVALID_LOGIN', message: 'Username or password is not correct.' };
  if (throttle.throttled(`ip:${ip}`, now, IP_WINDOW_MIN, IP_MAX_ATTEMPTS)) {
    return { ok: false, status: 429, error: 'TOO_MANY_ATTEMPTS', message: `Too many sign-in attempts. Try again in ${IP_WINDOW_MIN} minutes.` };
  }
  const user = await store.findUserByUsername(normalizeUsername(username));
  if (!user || user.status !== 'ACTIVE' || !user.password_hash) {
    timingHash ??= hashPassword(randomToken(8));
    await verifyPassword(await timingHash, pw); // similar timing for unknown accounts
    throttle.recordFailure(`ip:${ip}`, now, IP_WINDOW_MIN);
    return generic;
  }
  if (user.locked_until && new Date(user.locked_until) > now) {
    return { ok: false, status: 423, error: 'LOCKED', message: 'This account is locked after too many failed attempts. Ask the Admin to reset it, or try again later.' };
  }
  if (!(await verifyPassword(user.password_hash, pw))) {
    throttle.recordFailure(`ip:${ip}`, now, IP_WINDOW_MIN);
    const failed = user.failed_logins + 1;
    const lock = failed >= ctx.site.auth.lockout_after_failed;
    await store.updateUser(user.user_id, {
      failed_logins: lock ? 0 : failed,
      locked_until: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : user.locked_until,
      updated_at: nowIso(),
    });
    await store.appendActivity([{ actor: null, action: lock ? 'auth.lockout' : 'auth.login_failed', detail: { user_id: user.user_id } }]);
    if (lock) return { ok: false, status: 423, error: 'LOCKED', message: 'This account is now locked after too many failed attempts. Ask the Admin to reset it, or try again later.' };
    return generic;
  }
  const fresh = await store.updateUser(user.user_id, { failed_logins: 0, locked_until: null, last_login_at: nowIso(), updated_at: nowIso() });
  await store.appendActivity([{ actor: user.user_id, action: 'auth.login' }]);
  return { ok: true, user: fresh! };
}

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function normalizeUsername(u: unknown): string {
  return String(u ?? '').trim().toLowerCase();
}

export function usernameProblem(u: string): string | null {
  return USERNAME.test(u) ? null : 'Username: 3–32 characters, letters, digits, dot, dash or underscore (e.g. sara.k).';
}

/** Readable temporary password, e.g. "kite-4827-ramp". */
export function generatePassword(): string {
  const words = ['amber', 'blue', 'cedar', 'delta', 'ember', 'fjord', 'grove', 'harbor', 'iris', 'jade', 'kite', 'lumen', 'maple', 'north', 'olive', 'pearl', 'quartz', 'river', 'sage', 'tide', 'umber', 'vale', 'willow', 'zenith'];
  const b = randomBytes(6);
  return `${words[b[0] % words.length]}-${1000 + (((b[1] << 8) | b[2]) % 9000)}-${words[b[3] % words.length]}`;
}

export function newUser(fields: Pick<User, 'user_id' | 'username' | 'display_name' | 'role'> & Partial<User>): User {
  const t = nowIso();
  return {
    status: 'ACTIVE',
    groups: [],
    password_hash: null,
    must_change_password: false,
    session_epoch: 1,
    failed_logins: 0,
    locked_until: null,
    created_at: t,
    created_by: null,
    updated_at: t,
    last_login_at: null,
    ...fields,
  };
}

/** Admin sets (or resets) a password; ends the user's sessions (epoch) and unlocks the account. */
export async function setPasswordByAdmin(ctx: AppContext, userId: string, password: string, mustChange: boolean): Promise<void> {
  const u = await ctx.store.getUser(userId);
  if (!u) return;
  await ctx.store.updateUser(userId, {
    password_hash: await hashPassword(password),
    must_change_password: mustChange,
    failed_logins: 0,
    locked_until: null,
    session_epoch: u.session_epoch + 1,
    updated_at: nowIso(),
  });
}
