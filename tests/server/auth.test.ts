// Server tests for phase 1 (sign-in, sessions, guard, Admin/Member rights). Synthetic accounts only.
import { loadConfig } from '../../server/dictionary.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildRouter, handleApi } from '../../server/api.ts';
import { generatePassword, hashPassword, verifyPassword } from '../../server/auth/auth.ts';
import { can } from '../../server/auth/capabilities.ts';
import { makeContext, type AppContext } from '../../server/context.ts';
import type { Router } from '../../server/http.ts';
import { seedTestUsers } from '../../server/seed.ts';
import type { RegistryStore } from '../../server/store/types.ts';
import { makeTestStore } from './storeFactory.ts';

const PW = 'synthetic-pass-123';
const ORIGIN = 'http://app.test';
let clock: Date;
let ctx: AppContext;
let app: Router;
let store: RegistryStore;

/** A tiny browser: keeps cookies and the CSRF token between calls. */
class Client {
  cookie = '';
  csrf = '';
  ip: string;
  constructor(ip = '10.0.0.1') {
    this.ip = ip;
  }
  async call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { host: 'app.test', ...extra };
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') {
      headers.origin ??= ORIGIN;
      if (this.csrf && !('x-csrf-token' in extra)) headers['x-csrf-token'] = this.csrf;
    }
    const res = await handleApi(app, new Request(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), this.ip);
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      this.cookie = /=$/.test(kv) || /Max-Age=0/.test(c) ? '' : kv;
    }
    const data = await res.json();
    if (data?.csrf) this.csrf = data.csrf;
    return { status: res.status, data, res };
  }
  login(username: string, password = PW, remember = false) {
    return this.call('POST', '/api/auth/login', { username, password, remember });
  }
}

beforeEach(async () => {
  clock = new Date('2026-10-22T08:00:00Z');
  store = await makeTestStore();
  ctx = makeContext({ sessionSecret: 'test-secret-0123456789-0123456789-abcdef', secureCookies: true }, store, loadConfig(), () => clock);
  app = buildRouter(ctx);
  await seedTestUsers(store, PW, [
    { username: 'admin', name: 'Test Admin', role: 'ADMIN', groupIndex: [0, 1, 2] },
    { username: 'sara', name: 'Sara', role: 'MEMBER', groupIndex: [0] },
    { username: 'newbie', name: 'New', role: 'MEMBER', mustChange: true },
  ]);
});

describe('passwords', () => {
  it('hashes with PBKDF2 and verifies', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(await verifyPassword(h, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
    expect(await verifyPassword(null, 'x')).toBe(false);
  });
  it('generates readable passwords of allowed length', () => {
    for (let i = 0; i < 20; i++) expect(generatePassword()).toMatch(/^[a-z]+-\d{4}-[a-z]+$/);
  });
});

describe('sign-in', () => {
  it('signs in, sets a hardened cookie, and /me returns the user', async () => {
    const c = new Client();
    const r = await c.login('Admin ');
    expect(r.status).toBe(200);
    const cookie = r.res.headers.getSetCookie()[0];
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=43200/); // 12 h
    const me = await c.call('GET', '/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.data.user.role).toBe('ADMIN');
    expect(me.data.user.capabilities).toContain('users.manage');
  });

  it('"keep me signed in" lasts 30 days', async () => {
    const r = await new Client().login('sara', PW, true);
    expect(r.res.headers.getSetCookie()[0]).toMatch(/Max-Age=2592000/);
  });

  it('gives the same message for a wrong password and an unknown user', async () => {
    const a = await new Client().login('sara', 'wrong-password');
    const b = await new Client().login('nobody', 'wrong-password');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.data.error.message).toBe(b.data.error.message);
  });

  it('locks the account after 10 failures; the right password is refused while locked', async () => {
    const c = new Client('10.0.0.2');
    for (let i = 0; i < 9; i++) expect((await c.login('sara', 'nope-nope-nope')).status).toBe(401);
    const tenth = await c.login('sara', 'nope-nope-nope');
    expect(tenth.status).toBe(423);
    expect((await c.login('sara')).status).toBe(423);
    clock = new Date(clock.getTime() + 16 * 60_000);
    expect((await c.login('sara')).status).toBe(200);
  });

  it('throttles one IP after 30 failed attempts', async () => {
    const c = new Client('10.9.9.9');
    for (let i = 0; i < 30; i++) await c.login(`ghost${i}`, 'whatever-123');
    expect((await c.login('admin')).status).toBe(429);
    expect((await new Client('10.9.9.8').login('admin')).status).toBe(200);
  });

  it('expires the session after 12 hours', async () => {
    const c = new Client();
    await c.login('sara');
    clock = new Date(clock.getTime() + 13 * 3600_000);
    expect((await c.call('GET', '/api/auth/me')).status).toBe(401);
  });

  it('rejects a tampered cookie', async () => {
    const c = new Client();
    await c.login('sara');
    c.cookie = c.cookie.slice(0, -3) + 'abc';
    expect((await c.call('GET', '/api/auth/me')).status).toBe(401);
  });

  it('signs out on this device', async () => {
    const c = new Client();
    await c.login('sara');
    expect((await c.call('POST', '/api/auth/logout')).status).toBe(200);
    expect((await c.call('GET', '/api/auth/me')).status).toBe(401);
  });
});

describe('guard', () => {
  it('requires sign-in for protected routes', async () => {
    expect((await new Client().call('GET', '/api/groups')).status).toBe(401);
    expect((await new Client().call('GET', '/api/health')).status).toBe(200);
  });

  it('requires the CSRF token on changes', async () => {
    const c = new Client();
    await c.login('admin');
    const r = await c.call('POST', '/api/admin/users', { username: 'x.user', name: 'X', role: 'MEMBER' }, { 'x-csrf-token': 'forged' });
    expect(r.status).toBe(403);
    expect(r.data.error.code).toBe('CSRF');
  });

  it('refuses cross-site requests', async () => {
    const c = new Client();
    await c.login('admin');
    const r = await c.call('POST', '/api/auth/logout', {}, { origin: 'https://evil.example' });
    expect(r.data.error.code).toBe('BAD_ORIGIN');
  });

  it('a temporary password must be changed before anything else', async () => {
    const c = new Client();
    const r = await c.login('newbie');
    expect(r.data.must_change_password).toBe(true);
    expect((await c.call('GET', '/api/groups')).data.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await c.call('POST', '/api/auth/password', { current_password: PW, new_password: 'short' })).status).toBe(400);
    expect((await c.call('POST', '/api/auth/password', { current_password: 'wrong', new_password: 'a-much-better-pass' })).status).toBe(400);
    expect((await c.call('POST', '/api/auth/password', { current_password: PW, new_password: PW })).status).toBe(400);
    const ok = await c.call('POST', '/api/auth/password', { current_password: PW, new_password: 'a-much-better-pass' });
    expect(ok.status).toBe(200);
    expect((await c.call('GET', '/api/groups')).status).toBe(200);
  });

  it('changing a password signs out the other devices', async () => {
    const phone = new Client();
    const pc = new Client();
    await phone.login('sara');
    await pc.login('sara');
    await pc.call('POST', '/api/auth/password', { current_password: PW, new_password: 'brand-new-pass-1' });
    expect((await pc.call('GET', '/api/auth/me')).status).toBe(200);
    expect((await phone.call('GET', '/api/auth/me')).status).toBe(401);
  });
});

describe('Admin and Member rights', () => {
  it('capability map matches EP Workspace A11 (owner, 28 Oct: only the Admin adds cases)', () => {
    expect(can('MEMBER', 'case.create')).toBe(false);
    expect(can('ADMIN', 'case.create')).toBe(true);
    expect(can('MEMBER', 'case.delete')).toBe(true);
    expect(can('MEMBER', 'case.import')).toBe(false);
    expect(can('MEMBER', 'case.restore')).toBe(false);
    expect(can('MEMBER', 'users.manage')).toBe(false);
    expect(can('MEMBER', 'dashboard.view')).toBe(false);
    expect(can('ADMIN', 'case.import')).toBe(true);
    expect(can('ADMIN', 'export.all')).toBe(true);
  });

  it('a Member cannot list or create users', async () => {
    const c = new Client();
    await c.login('sara');
    expect((await c.call('GET', '/api/admin/users')).status).toBe(403);
    expect((await c.call('POST', '/api/admin/users', { username: 'sneaky', name: 'S', role: 'ADMIN' })).status).toBe(403);
  });

  it('Admin creates a user with a generated one-time password; the user must change it', async () => {
    const admin = new Client();
    await admin.login('admin');
    const groups = (await admin.call('GET', '/api/groups')).data.groups;
    const r = await admin.call('POST', '/api/admin/users', { username: 'Omar.K', name: 'Omar K', role: 'MEMBER', groups: [groups[1].group_id, 'grp_fake'] });
    expect(r.status).toBe(200);
    expect(r.data.username).toBe('omar.k');
    expect(r.data.password).toMatch(/^[a-z]+-\d{4}-[a-z]+$/);
    const list = (await admin.call('GET', '/api/admin/users')).data.users;
    const omar = list.find((u: { username: string }) => u.username === 'omar.k');
    expect(omar.groups).toEqual([groups[1].group_id]);
    expect(JSON.stringify(list)).not.toMatch(/pbkdf2/);
    const u = new Client('10.0.0.5');
    expect((await u.login('omar.k', r.data.password)).data.must_change_password).toBe(true);
    // Passwords never appear in the activity log.
    expect(JSON.stringify(await store.listActivity())).not.toContain(r.data.password);
  });

  it('validates new users', async () => {
    const admin = new Client();
    await admin.login('admin');
    expect((await admin.call('POST', '/api/admin/users', { username: 'a', name: 'A', role: 'MEMBER' })).data.error.details.field).toBe('username');
    expect((await admin.call('POST', '/api/admin/users', { username: 'sara', name: 'Dup', role: 'MEMBER' })).status).toBe(409);
    expect((await admin.call('POST', '/api/admin/users', { username: 'okname', name: '', role: 'MEMBER' })).data.error.details.field).toBe('name');
    expect((await admin.call('POST', '/api/admin/users', { username: 'okname', name: 'Ok', role: 'OWNER' })).data.error.details.field).toBe('role');
    expect((await admin.call('POST', '/api/admin/users', { username: 'okname', name: 'Ok', role: 'MEMBER', password: 'short' })).data.error.details.field).toBe('password');
  });

  it('disabling a user ends their session; Admin cannot disable or demote themselves', async () => {
    const admin = new Client();
    await admin.login('admin');
    const sara = new Client('10.0.0.7');
    await sara.login('sara');
    const users = (await admin.call('GET', '/api/admin/users')).data.users;
    const saraId = users.find((u: { username: string }) => u.username === 'sara').user_id;
    const adminId = users.find((u: { username: string }) => u.username === 'admin').user_id;
    expect((await admin.call('PATCH', `/api/admin/users/${saraId}`, { status: 'DISABLED' })).status).toBe(200);
    expect((await sara.call('GET', '/api/auth/me')).status).toBe(401);
    expect((await sara.login('sara')).status).toBe(401);
    expect((await admin.call('PATCH', `/api/admin/users/${adminId}`, { status: 'DISABLED' })).status).toBe(400);
    expect((await admin.call('PATCH', `/api/admin/users/${adminId}`, { role: 'MEMBER' })).status).toBe(400);
  });

  it('Admin sets a new password (unlocks the account)', async () => {
    const admin = new Client();
    await admin.login('admin');
    const c = new Client('10.0.0.8');
    for (let i = 0; i < 10; i++) await c.login('sara', 'nope-nope-nope');
    expect((await c.login('sara')).status).toBe(423);
    const saraId = (await admin.call('GET', '/api/admin/users')).data.users.find((u: { username: string }) => u.username === 'sara').user_id;
    const r = await admin.call('POST', `/api/admin/users/${saraId}/password`, {});
    expect(r.data.password).toBeTruthy();
    expect((await c.login('sara', r.data.password)).status).toBe(200);
  });
});
