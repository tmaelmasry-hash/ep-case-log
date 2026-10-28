// Follow-up bell (phase 12): GET /api/followups — the user's groups only. Switched off by default
// (config/site.json followup_due.enabled: false): the answer is then an empty list and the app shows no bell.
import { followUpsDue } from '../domain/followups.ts';
import { siteLocalDate } from '../appconfig.ts';
import { groupIdsFor, requireCap, type Router } from '../http.ts';

export function followupRoutes(app: Router) {
  const { ctx } = app;
  const { store, config } = ctx;
  app.get('/api/followups', async (req) => {
    const u = requireCap(req, 'case.read');
    const rule = config.site.followup_due;
    const today = siteLocalDate(config.site.timezone, ctx.now());
    if (!rule?.enabled) return { enabled: false, today, items: [] };
    const mine = new Set(await groupIdsFor(ctx, u));
    const cases = (await store.listCases()).filter((c) => mine.has(c.meta.group_id));
    return { enabled: true, today, ahead_days: rule.ahead_days, items: followUpsDue(rule, cases, today) };
  });
}
