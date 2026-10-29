import { attemptLogin, clearSessionCookie, createSession, hashPassword, passwordProblem, verifyPassword } from '../auth/auth.ts';
import { capabilitiesOf } from '../auth/capabilities.ts';
import { HttpError, badRequest, type Router } from '../http.ts';
import { nowIso } from '../util.ts';

export function authRoutes(app: Router) {
  const { ctx } = app;
  const { store } = ctx;

  app.post('/api/auth/login', async (req, reply) => {
    const { username, password, remember } = req.body ?? {};
    const r = await attemptLogin(ctx, req.ip, username, password);
    if (!r.ok) throw new HttpError(r.status, r.error, r.message);
    const csrf = await createSession(ctx, reply, r.user, { remember: remember === true });
    return { ok: true, csrf, must_change_password: r.user.must_change_password };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    // Removes the cookie on this device; ending every session of a user = raising session_epoch.
    clearSessionCookie(ctx, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const u = req.user!;
    const row = await store.getUser(u.userId);
    return {
      user: { id: u.userId, username: u.username, name: u.name, role: u.role, capabilities: capabilitiesOf(u.role), must_change_password: u.mustChangePassword, groups: row?.groups ?? [] },
      csrf: u.csrf,
      features: { followups: !!ctx.config.site.followup_due?.enabled },
    };
  });

  /** The signed-in user changes their own password (required after an Admin-set temporary password). */
  app.post('/api/auth/password', async (req, reply) => {
    const u = req.user!;
    const { current_password, new_password } = req.body ?? {};
    const row = (await store.getUser(u.userId))!;
    if (!(await verifyPassword(row.password_hash, String(current_password ?? '')))) throw badRequest('Your current password is not correct.', { field: 'current_password' });
    const problem = passwordProblem(new_password);
    if (problem) throw badRequest(problem, { field: 'new_password' });
    if (new_password === current_password) throw badRequest('Choose a password different from the current one.', { field: 'new_password' });
    const user = await store.updateUser(u.userId, {
      password_hash: await hashPassword(new_password),
      must_change_password: false,
      session_epoch: row.session_epoch + 1,
      updated_at: nowIso(),
    });
    await store.appendActivity([{ actor: u.userId, action: 'auth.password_changed' }]);
    // Other devices are signed out (epoch); this one gets a fresh session.
    return { ok: true, csrf: await createSession(ctx, reply, user!, { remember: u.remember }) };
  });
}
