// Admin dashboard (dashboard.view) and My work (every user, own cases in own groups) — phase 9.
import { buildDashboard, buildMyWork, collectorOf, localDay, weekStart } from '../domain/dashboard.ts';
import { HttpError, groupIdsFor, requireCap, type Router } from '../http.ts';

export function dashboardRoutes(app: Router) {
  const { ctx } = app;
  const { store } = ctx;
  const { dict, site } = ctx.config;

  /** Group and basis from the query (GET) or the body (POST); POST may also name the cases of the filtered list (R2-8). */
  const dashboard = async (q: { group?: string; basis?: string; case_ids?: unknown }) => {
    const basis = q.basis === 'ALL' ? 'ALL' : 'COMPLETED';
    const [cases, groups, users] = await Promise.all([store.listCases(), store.listGroups(), store.listUsers()]);
    let scope = groups.filter((g) => !g.is_deleted).sort((a, b) => a.sort_order - b.sort_order);
    if (q.group && q.group !== 'ALL') {
      scope = scope.filter((g) => g.group_id === q.group);
      if (!scope.length) throw new HttpError(404, 'NOT_FOUND', 'Unknown group.');
    }
    const ids = new Set(scope.map((g) => g.group_id));
    const only = Array.isArray(q.case_ids) ? new Set(q.case_ids.map(String)) : null;
    return buildDashboard(dict, site, { cases: cases.filter((c) => ids.has(c.meta.group_id) && (!only || only.has(c.meta.case_id))), groups: scope, users, basis, now: ctx.now() });
  };

  app.get('/api/dashboard', async (req) => {
    requireCap(req, 'dashboard.view');
    return dashboard({ group: req.query.group, basis: req.query.basis });
  });

  app.post('/api/dashboard', async (req) => {
    requireCap(req, 'dashboard.view');
    const b = req.body ?? {};
    return dashboard({ group: b.group, basis: b.basis, case_ids: b.case_ids });
  });

  app.get('/api/mywork', async (req) => {
    const u = requireCap(req, 'mywork.view');
    const mine = await groupIdsFor(ctx, u);
    const [cases, groups] = await Promise.all([store.listCases(), store.listGroups()]);
    // Owner, 28 Oct: only the Admin adds cases, so a case nobody has filled in yet is work for every Member of its group.
    const untouched = (c: (typeof cases)[number]) => u.role === 'MEMBER' && !c.meta.collector_user_id;
    const own = cases.filter((c) => !c.meta.is_deleted && mine.includes(c.meta.group_id) && (collectorOf(c) === u.userId || untouched(c)));
    // "Done this week" (step 5): cases this user marked Completed since Sunday, in the user's groups.
    const now = ctx.now();
    const from = weekStart(now, site.timezone);
    const doneThisWeek = cases.filter(
      (c) => !c.meta.is_deleted && mine.includes(c.meta.group_id) && c.meta.collection_status === 'COMPLETED' && c.meta.completed_by === u.userId && !!c.meta.completed_at && localDay(new Date(c.meta.completed_at), site.timezone) >= from,
    ).length;
    return buildMyWork(dict, site, { mine: own, groups, now, doneThisWeek });
  });
}
