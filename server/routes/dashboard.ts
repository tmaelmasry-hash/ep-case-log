// Admin dashboard (dashboard.view) and My work (every user, own cases in own groups) — phase 9.
import { buildDashboard, buildMyWork, collectorOf } from '../domain/dashboard.ts';
import { HttpError, groupIdsFor, requireCap, type Router } from '../http.ts';

export function dashboardRoutes(app: Router) {
  const { ctx } = app;
  const { store } = ctx;
  const { dict, site } = ctx.config;

  app.get('/api/dashboard', async (req) => {
    requireCap(req, 'dashboard.view');
    const basis = req.query.basis === 'ALL' ? 'ALL' : 'COMPLETED';
    const [cases, groups, users] = await Promise.all([store.listCases(), store.listGroups(), store.listUsers()]);
    let scope = groups.filter((g) => !g.is_deleted).sort((a, b) => a.sort_order - b.sort_order);
    if (req.query.group && req.query.group !== 'ALL') {
      scope = scope.filter((g) => g.group_id === req.query.group);
      if (!scope.length) throw new HttpError(404, 'NOT_FOUND', 'Unknown group.');
    }
    const ids = new Set(scope.map((g) => g.group_id));
    return buildDashboard(dict, site, { cases: cases.filter((c) => ids.has(c.meta.group_id)), groups: scope, users, basis, now: ctx.now() });
  });

  app.get('/api/mywork', async (req) => {
    const u = requireCap(req, 'mywork.view');
    const mine = await groupIdsFor(ctx, u);
    const [cases, groups] = await Promise.all([store.listCases(), store.listGroups()]);
    const own = cases.filter((c) => !c.meta.is_deleted && mine.includes(c.meta.group_id) && collectorOf(c) === u.userId);
    return buildMyWork(dict, site, { mine: own, groups, now: ctx.now() });
  });
}
