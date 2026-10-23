// Custom cohorts (owner R2-12): everyone reads them; only the Admin makes, edits, deletes and tags cases by hand.
// Members see a cohort with their own groups' cases only (the case list is already limited to their groups).
import { COHORT_COLORS, checkCohort, meetsRule, type CohortDef } from '../../shared/cohorts.ts';
import { decodeRows } from '../domain/cases.ts';
import { HttpError, badRequest, groupIdsFor, notFound, requireCap, type Router } from '../http.ts';
import type { AppContext } from '../context.ts';
import type { CaseRecord } from '../../shared/caseTypes.ts';

export const COHORTS_KEY = 'cohorts';
export const OVERRIDES_KEY = 'cohort_overrides';

export interface BuiltinOverride {
  label?: string;
  color?: string;
  hidden?: boolean;
}

/** Custom cohorts each case belongs to: rule cohorts it meets plus tag cohorts it was added to. */
export async function cohortMembership(ctx: AppContext, cases: CaseRecord[]): Promise<Map<string, string[]>> {
  const [defs, tags] = await Promise.all([ctx.store.getSetting<CohortDef[]>(COHORTS_KEY, []), ctx.store.listCohortTags()]);
  const live = defs.filter((d) => !d.deleted);
  const out = new Map<string, string[]>();
  if (!live.length) return out;
  const tagged = new Set(tags.filter((t) => t.on).map((t) => `${t.cohort_id}/${t.case_id}`));
  const rules = live.filter((d) => d.kind === 'rule');
  for (const c of cases) {
    const rows = rules.length ? decodeRows(ctx.config.dict, c) : {};
    const ids = live.filter((d) => (d.kind === 'tag' ? tagged.has(`${d.id}/${c.meta.case_id}`) : meetsRule(ctx.config.dict, d, rows))).map((d) => d.id);
    if (ids.length) out.set(c.meta.case_id, ids);
  }
  return out;
}

export function cohortRoutes(app: Router) {
  const { ctx } = app;
  const { store } = ctx;
  const { dict } = ctx.config;

  const all = () => store.getSetting<CohortDef[]>(COHORTS_KEY, []);
  const fields = (b: Record<string, unknown>) => ({
    name: String(b.name ?? '').trim(),
    kind: b.kind === 'tag' ? ('tag' as const) : b.kind === 'rule' ? ('rule' as const) : (b.kind as 'rule'),
    color: COHORT_COLORS.includes(String(b.color)) ? String(b.color) : COHORT_COLORS[0],
    note: typeof b.note === 'string' ? b.note.trim().slice(0, 300) : '',
    match: b.match === 'ANY' ? ('ANY' as const) : ('ALL' as const),
    conditions: Array.isArray(b.conditions) ? (b.conditions as CohortDef['conditions']) : [],
  });

  app.get('/api/cohorts', async (req) => {
    requireCap(req, 'case.read');
    const [cohorts, overrides] = await Promise.all([all(), store.getSetting<Record<string, BuiltinOverride>>(OVERRIDES_KEY, {})]);
    return { cohorts: cohorts.filter((c) => !c.deleted), overrides };
  });

  /** The built-in cohorts of config/categories.json (pilgrims, follow-up, ...): the Admin renames, recolors or hides
   *  them; they are never deleted (owner, 23 Oct). `reset: true` brings back the defaults. */
  app.post('/api/cohorts/builtin/:id', async (req) => {
    const u = requireCap(req, 'cohorts.manage');
    const id = req.params.id;
    if (!/^[A-Z][A-Z0-9_]{1,40}$/.test(id)) throw notFound('Cohort not found.');
    const b = req.body ?? {};
    const overrides = await store.getSetting<Record<string, BuiltinOverride>>(OVERRIDES_KEY, {});
    if (b.reset === true) delete overrides[id];
    else {
      const label = typeof b.label === 'string' ? b.label.trim() : '';
      if (label.length > 60) throw badRequest('Use up to 60 characters.', { field: 'label' });
      overrides[id] = {
        ...(label ? { label } : {}),
        ...(COHORT_COLORS.includes(String(b.color)) ? { color: String(b.color) } : {}),
        ...(b.hidden === true ? { hidden: true } : {}),
      };
    }
    await store.setSetting(OVERRIDES_KEY, overrides, u.userId);
    await store.appendActivity([{ actor: u.userId, action: 'cohort.edit', detail: { cohort: overrides[id]?.label ?? id } }]);
    return { overrides };
  });

  /** How many of the user's cases a rule would hold now (the form shows it while the Admin builds the rule). */
  app.post('/api/cohorts/preview', async (req) => {
    requireCap(req, 'cohorts.manage');
    const d = { ...fields(req.body ?? {}), kind: 'rule' as const, name: 'preview' };
    const problem = checkCohort(dict, d);
    if (problem) throw badRequest(problem);
    const groups = await groupIdsFor(ctx, req.user!);
    const cases = (await store.listCases()).filter((c) => !c.meta.is_deleted && groups.includes(c.meta.group_id));
    const def = { ...d, id: 'preview', color: '', created_at: '', created_by: '' };
    return { count: cases.filter((c) => meetsRule(dict, def, decodeRows(dict, c))).length };
  });

  app.post('/api/cohorts', async (req) => {
    const u = requireCap(req, 'cohorts.manage');
    const d = fields(req.body ?? {});
    const problem = checkCohort(dict, d);
    if (problem) throw badRequest(problem);
    const list = await all();
    if (list.some((c) => !c.deleted && c.name.toLowerCase() === d.name.toLowerCase())) throw new HttpError(409, 'NAME_TAKEN', 'A cohort with this name already exists.', { field: 'name' });
    const def: CohortDef = { id: `cohort_${crypto.randomUUID()}`, ...d, ...(d.kind === 'tag' ? { match: undefined, conditions: undefined } : {}), created_at: ctx.now().toISOString(), created_by: u.userId };
    await store.setSetting(COHORTS_KEY, [...list, def], u.userId);
    await store.appendActivity([{ actor: u.userId, action: 'cohort.create', detail: { cohort: def.name, kind: def.kind } }]);
    return def;
  });

  app.patch('/api/cohorts/:id', async (req) => {
    const u = requireCap(req, 'cohorts.manage');
    const list = await all();
    const i = list.findIndex((c) => c.id === req.params.id && !c.deleted);
    if (i < 0) throw notFound('Cohort not found.');
    const d = { ...fields({ ...list[i], ...(req.body ?? {}) }), kind: list[i].kind }; // the kind never changes
    const problem = checkCohort(dict, d);
    if (problem) throw badRequest(problem);
    if (list.some((c, k) => k !== i && !c.deleted && c.name.toLowerCase() === d.name.toLowerCase())) throw new HttpError(409, 'NAME_TAKEN', 'A cohort with this name already exists.', { field: 'name' });
    list[i] = { ...list[i], ...d, ...(d.kind === 'tag' ? { match: undefined, conditions: undefined } : {}) };
    await store.setSetting(COHORTS_KEY, list, u.userId);
    await store.appendActivity([{ actor: u.userId, action: 'cohort.edit', detail: { cohort: list[i].name } }]);
    return list[i];
  });

  app.post('/api/cohorts/:id/delete', async (req) => {
    const u = requireCap(req, 'cohorts.manage');
    const list = await all();
    const c = list.find((x) => x.id === req.params.id && !x.deleted);
    if (!c) throw notFound('Cohort not found.');
    c.deleted = true; // kept so the activity log and old exports still make sense; tags stay in their tab
    await store.setSetting(COHORTS_KEY, list, u.userId);
    await store.appendActivity([{ actor: u.userId, action: 'cohort.delete', detail: { cohort: c.name } }]);
    return { ok: true };
  });

  /** Adds a case to a tag cohort, or takes it out (Admin). */
  app.post('/api/cohorts/:id/cases/:case', async (req) => {
    const u = requireCap(req, 'cohorts.manage');
    const c = (await all()).find((x) => x.id === req.params.id && !x.deleted);
    if (!c) throw notFound('Cohort not found.');
    if (c.kind !== 'tag') throw badRequest('Cases join a rule cohort on their own.');
    const rec = await store.getCase(req.params.case);
    if (!rec || rec.meta.is_deleted) throw notFound('Case not found.');
    const on = req.body?.on !== false;
    await store.setCohortTag(c.id, rec.meta.case_id, on, u.userId);
    await store.appendActivity([{ actor: u.userId, action: on ? 'cohort.tag' : 'cohort.untag', detail: { cohort: c.name, case: `${rec.meta.mrn} No. ${rec.meta.group_seq}` } }]);
    return { ok: true, on };
  });
}
