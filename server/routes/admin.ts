// Admin: users (username + password typed or generated, role, groups, new password, disable, unlock), groups
// (add, rename) and the activity log — ported from EP Workspace routes/admin.ts.
import { generatePassword, newUser, normalizeUsername, passwordProblem, setPasswordByAdmin, usernameProblem } from '../auth/auth.ts';
import { badRequest, conflict, groupIdsFor, notFound, requireCap, type Req, type Router } from '../http.ts';
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

  /** Groups the user may see (Admin: all), with their number of cases and the next case number. */
  app.get('/api/groups', async (req) => {
    const u = requireCap(req, 'case.read');
    const mine = new Set(await groupIdsFor(ctx, u));
    const cases = (await store.listCases()).filter((c) => !c.meta.is_deleted);
    return {
      groups: (await store.listGroups())
        .filter((g) => mine.has(g.group_id))
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((g) => ({ group_id: g.group_id, name: g.name, cases: cases.filter((c) => c.meta.group_id === g.group_id).length, next_seq: g.next_seq })),
    };
  });

  async function groupName(raw: unknown, except?: string): Promise<string> {
    const name = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!name) throw badRequest('Enter a group name.', { field: 'name' });
    const clash = (await store.listGroups()).some((g) => !g.is_deleted && g.group_id !== except && g.name.toLowerCase() === name.toLowerCase());
    if (clash) throw conflict('GROUP_EXISTS', 'A group with this name already exists.', { field: 'name' });
    return name;
  }

  /** Add a group (Admin). Its numbering starts at No. 1. */
  app.post('/api/groups', async (req) => {
    const admin = requireCap(req, 'groups.manage');
    const name = await groupName((req.body ?? {}).name);
    const groups = await store.listGroups();
    const g = { group_id: newId('grp'), name, sort_order: Math.max(0, ...groups.map((x) => x.sort_order)) + 1, next_seq: 1, is_deleted: false, created_at: nowIso() };
    await store.createGroup(g);
    await store.appendActivity([{ actor: admin.userId, action: 'group.create', detail: { group_id: g.group_id, name } }]);
    return { group_id: g.group_id, name };
  });

  /** Rename a group (Admin). Case numbers do not change. */
  app.patch('/api/groups/:id', async (req) => {
    const admin = requireCap(req, 'groups.manage');
    const g = (await store.listGroups()).find((x) => x.group_id === req.params.id && !x.is_deleted);
    if (!g) throw notFound('Group not found.');
    const name = await groupName((req.body ?? {}).name, g.group_id);
    await store.updateGroup(g.group_id, { name });
    await store.appendActivity([{ actor: admin.userId, action: 'group.rename', detail: { group_id: g.group_id, name } }]);
    return { ok: true };
  });

  /** Activity log (EP Workspace F-17, Admin): newest first. Field names only, never the values typed. Edits by one
   *  person to one case within two minutes are one line. */
  app.get('/api/admin/activity', async (req) => {
    requireCap(req, 'audit.view');
    const { dict } = ctx.config;
    const limit = Math.min(Math.max(Number(req.query.limit) || 300, 1), 1000);
    const [log, users, cases, groups] = await Promise.all([store.listActivity(), store.listUsers(), store.listCases(), store.listGroups()]);
    const who = new Map(users.map((u) => [u.user_id, u.display_name]));
    const userName = new Map(users.map((u) => [u.user_id, u.username]));
    const caseOf = new Map(cases.map((c) => [c.meta.case_id, c.meta]));
    const gname = new Map(groups.map((g) => [g.group_id, g.name]));
    const fieldLabel = (k: string) => {
      const [e, f] = k.split('.');
      return dict.entities[e]?.fields.find((x) => x.name === f)?.label ?? k;
    };
    const entityLabel = (e: string) => dict.entities[e]?.label ?? e;
    type D = Record<string, any>;
    const kindOf = (a: string, d: D): string => {
      if (a === 'case.edit') return !d.fields?.length && !d.removed?.length && !d.additional && d.added?.length ? 'ADD' : !d.fields?.length && !d.added?.length && !d.additional && d.removed?.length ? 'REMOVE' : 'EDIT';
      return ({ 'case.create': 'NEW CASE', 'case.delete': 'DELETE', 'case.restore': 'RESTORE', 'case.complete': 'COMPLETE', 'case.reopen': 'REOPEN', 'auth.login': 'SIGN IN', 'auth.password_changed': 'PASSWORD', 'auth.lockout': 'LOCKED', 'import.mrns': 'BULK ADD' } as D)[a] ?? 'ADMIN';
    };
    const parts = (a: string, d: D): string[] => {
      switch (a) {
        case 'case.edit':
          return [...(d.fields ?? []).map(fieldLabel), ...(d.added ?? []).map((e: string) => `${entityLabel(e)} added`), ...(d.removed ?? []).map((e: string) => `${entityLabel(e)} removed`), ...(d.additional ? ['Additional information'] : [])];
        case 'case.complete':
          return d.core ? [`core ${d.core}`] : [];
        case 'case.create':
        case 'case.delete':
        case 'case.restore':
        case 'case.reopen':
          return [];
        case 'user.create':
          return [`User ${d.username ?? ''} added`];
        case 'user.update':
          return [`User ${userName.get(d.user_id) ?? ''} changed`];
        case 'user.password_set':
          return [`New password for ${userName.get(d.user_id) ?? 'a user'}`];
        case 'import.mrns':
          return [`${d.added} of ${d.total} MRNs added to ${gname.get(d.group_id) ?? 'a group'}`];
        case 'group.create':
          return [`Group ${d.name} added`];
        case 'group.rename':
          return [`Group renamed to ${d.name}`];
        case 'auth.lockout':
          return [`${userName.get(d.user_id) ?? 'A user'} locked after failed sign-ins`];
        default:
          return a.startsWith('auth.') ? [] : [a.replace(/[._]/g, ' ')];
      }
    };
    const out: { at: string; first_at: string; kind: string; actor_id: string | null; actor: string; case_id: string | null; mrn: string | null; group: string | null; items: string[] }[] = [];
    for (const a of log.slice().reverse()) {
      if (a.action === 'auth.login_failed') continue;
      const d = (a.detail ?? {}) as D;
      const m = d.case_id ? caseOf.get(d.case_id) : undefined;
      const kind = kindOf(a.action, d);
      const items = parts(a.action, d);
      const prev = out[out.length - 1];
      // Newest first: an older edit joins the line above when it is the same person and case within two minutes.
      if (prev && ['EDIT', 'ADD', 'REMOVE'].includes(kind) && ['EDIT', 'ADD', 'REMOVE'].includes(prev.kind) && prev.case_id === (d.case_id ?? null) && prev.actor_id === a.actor && Date.parse(prev.first_at) - Date.parse(a.at) <= 120_000) {
        for (const x of items) if (!prev.items.includes(x)) prev.items.push(x);
        if (prev.kind !== kind) prev.kind = 'EDIT';
        prev.first_at = a.at;
        continue;
      }
      if (out.length >= limit) break;
      out.push({ at: a.at, first_at: a.at, kind, actor_id: a.actor, actor: a.actor ? (who.get(a.actor) ?? 'Unknown') : 'System', case_id: d.case_id ?? null, mrn: m?.mrn ?? null, group: m ? `${gname.get(m.group_id) ?? ''} No. ${m.group_seq}` : null, items });
    }
    return { items: out.map(({ first_at: _f, actor_id: _a, items, ...x }) => ({ ...x, details: items.slice(0, 12).join(', ') + (items.length > 12 ? ` and ${items.length - 12} more` : '') })) };
  });
}
