// Admin: users (username + password typed or generated, role, groups, new password, disable, unlock) — ported from
// EP Workspace routes/admin.ts. Group management (add/rename) comes with phase 3; this phase lists groups for the user form.
import { generatePassword, newUser, normalizeUsername, passwordProblem, setPasswordByAdmin, usernameProblem } from '../auth/auth.ts';
import { badRequest, conflict, notFound, requireCap, type Req, type Router } from '../http.ts';
import type { User } from '../store/types.ts';
import { newId, nowIso } from '../util.ts';

export function adminRoutes(app: Router) {
  const { ctx } = app;
  const { store } = ctx;

  /** The address users open the app at, for the "send to user" text. */
  function appUrl(req: Req) {
    const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost';
    const proto = req.headers['x-forwarded-proto'] ?? (/^(localhost|127\.)/.test(String(host)) ? 'http' : 'https');
    return `${proto}://${host}/`;
  }

  async function cleanGroups(groupIds: unknown): Promise<string[] | undefined> {
    if (!Array.isArray(groupIds)) return undefined;
    const valid = new Set((await store.listGroups()).filter((g) => !g.is_deleted).map((g) => g.group_id));
    return [...new Set(groupIds.map(String))].filter((g) => valid.has(g));
  }

  app.get('/api/admin/users', async (req) => {
    requireCap(req, 'users.manage');
    const users = (await store.listUsers()).sort((a, b) => a.role.localeCompare(b.role) || a.display_name.localeCompare(b.display_name));
    const now = ctx.now();
    return {
      users: users.map((x) => ({
        user_id: x.user_id,
        username: x.username,
        display_name: x.display_name,
        role: x.role,
        status: x.status,
        groups: x.groups,
        must_change_password: x.must_change_password,
        locked: !!x.locked_until && new Date(x.locked_until) > now,
        last_login_at: x.last_login_at,
      })),
    };
  });

  /** Admin creates the account; with must_change the user sets their own password at first sign-in. */
  app.post('/api/admin/users', async (req) => {
    const admin = requireCap(req, 'users.manage');
    const b = req.body ?? {};
    const username = normalizeUsername(b.username);
    const name = String(b.name ?? '').trim().slice(0, 80);
    const uProblem = usernameProblem(username);
    if (uProblem) throw badRequest(uProblem, { field: 'username' });
    if (!name) throw badRequest('Enter a display name.', { field: 'name' });
    if (!['ADMIN', 'MEMBER'].includes(b.role)) throw badRequest('Role must be Admin or Member.', { field: 'role' });
    if (await store.findUserByUsername(username)) throw conflict('USERNAME_EXISTS', 'This username is already taken.', { field: 'username' });
    const generated = !b.password;
    const password = generated ? generatePassword() : String(b.password);
    const pProblem = passwordProblem(password);
    if (pProblem) throw badRequest(pProblem, { field: 'password' });
    const mustChange = b.must_change_password !== false;
    const userId = newId('usr');
    const groups = (await cleanGroups(b.groups)) ?? [];
    await store.createUser(newUser({ user_id: userId, username, display_name: name, role: b.role, groups, must_change_password: mustChange, created_by: admin.userId }));
    await setPasswordByAdmin(ctx, userId, password, mustChange);
    await store.appendActivity([{ actor: admin.userId, action: 'user.create', detail: { user_id: userId, username, role: b.role, groups, must_change_password: mustChange } }]);
    // The password is returned only when the server generated it. Never logged.
    return { user_id: userId, username, password: generated ? password : null, must_change_password: mustChange, app_url: appUrl(req) };
  });

  app.post('/api/admin/users/:id/password', async (req) => {
    const admin = requireCap(req, 'users.manage');
    const user = await store.getUser(req.params.id);
    if (!user) throw notFound('User not found.');
    const b = req.body ?? {};
    const generated = !b.password;
    const password = generated ? generatePassword() : String(b.password);
    const pProblem = passwordProblem(password);
    if (pProblem) throw badRequest(pProblem, { field: 'password' });
    const mustChange = b.must_change_password !== false;
    await setPasswordByAdmin(ctx, user.user_id, password, mustChange);
    await store.appendActivity([{ actor: admin.userId, action: 'user.password_set', detail: { user_id: user.user_id, must_change_password: mustChange } }]);
    return { username: user.username, password: generated ? password : null, must_change_password: mustChange, app_url: appUrl(req) };
  });

  app.patch('/api/admin/users/:id', async (req) => {
    const admin = requireCap(req, 'users.manage');
    const user = await store.getUser(req.params.id);
    if (!user) throw notFound('User not found.');
    const b = req.body ?? {};
    const changes: Partial<User> = {};
    if (b.role && ['ADMIN', 'MEMBER'].includes(b.role) && b.role !== user.role) {
      if (user.user_id === admin.userId) throw badRequest('You cannot change your own role.');
      changes.role = b.role;
    }
    if (b.status && ['ACTIVE', 'DISABLED'].includes(b.status) && b.status !== user.status) {
      if (user.user_id === admin.userId) throw badRequest('You cannot disable yourself.');
      changes.status = b.status;
    }
    if (typeof b.name === 'string' && b.name.trim()) changes.display_name = b.name.trim().slice(0, 80);
    const patch: Partial<User> = { ...changes };
    // A role or status change ends every session of that user at once.
    if (changes.role || changes.status) patch.session_epoch = user.session_epoch + 1;
    if (b.groups) patch.groups = (await cleanGroups(b.groups)) ?? user.groups;
    if (b.unlock) Object.assign(patch, { locked_until: null, failed_logins: 0 });
    if (Object.keys(patch).length) await store.updateUser(user.user_id, { ...patch, updated_at: nowIso() });
    await store.appendActivity([{ actor: admin.userId, action: 'user.update', detail: { user_id: user.user_id, ...changes, groups: patch.groups, unlock: !!b.unlock } }]);
    return { ok: true };
  });

  app.get('/api/groups', async (req) => {
    requireCap(req, 'case.read');
    return { groups: (await store.listGroups()).filter((g) => !g.is_deleted).sort((a, b) => a.sort_order - b.sort_order).map((g) => ({ group_id: g.group_id, name: g.name })) };
  });
}
