// Admin dashboard and the user's "My work" (phase 9; ported from EP Workspace server/domain/dashboard.ts).
// Counts only — no patient identifiers on the dashboard, no outcome analytics. Clinical counts are per procedure
// (case = episode with several procedures): category from the procedure's components, date = its start date,
// acute success from that procedure's endpoint field, complications from its review. Rules: config/site.json dashboard.
import type { CaseRecord, DecodedRow } from '../../shared/caseTypes.ts';
import type { Dictionary } from '../../shared/dictionary.ts';
import { categoriesOf, type Readiness } from '../../shared/readiness.ts';
import type { Site } from '../appconfig.ts';
import type { Group, User } from '../store/types.ts';
import { decodeRows, readinessOf } from './cases.ts';
import { inHajjSeason } from '../../shared/derive.ts';

const DAY = 86_400_000;

export interface DashRule {
  field: string;
  success: string[];
  not_counted?: string[];
  gate?: 'CANON_AF_ENDPOINT_V1';
}
export interface DashConfig {
  stale_days: number;
  procedure_date_field: string;
  pilgrim_field: string;
  complications_field: string;
  complications_present_code: string;
  complications_reviewed_codes: string[];
  acute_success: Record<string, DashRule>;
}

/** Fails at start-up (not on a dashboard view) if a field or code is not in the dictionary. */
export function checkDashConfig(dict: Dictionary, d: DashConfig) {
  const field = (path: string) => {
    const [e, f] = path.split('.');
    const x = dict.entities[e]?.fields.find((y) => y.name === f);
    if (!x) throw new Error(`site.json dashboard: unknown field ${path}`);
    return x;
  };
  field(d.procedure_date_field);
  field(d.pilgrim_field);
  const cx = field(d.complications_field);
  for (const c of [d.complications_present_code, ...d.complications_reviewed_codes]) if (!cx.codes?.some((y) => y.code === c)) throw new Error(`site.json dashboard: ${c} is not a code of ${d.complications_field}`);
  for (const [cat, r] of Object.entries(d.acute_success)) {
    if (!(cat in dict.coreSpec.categories)) throw new Error(`site.json dashboard: unknown category ${cat}`);
    const f = field(r.field);
    for (const c of [...r.success, ...(r.not_counted ?? [])]) if (!f.codes?.some((y) => y.code === c)) throw new Error(`site.json dashboard: ${c} is not a code of ${r.field}`);
  }
  for (const g of AF_GATE_FIELDS) field(g);
}

export const AF_GATE_FIELDS = [
  'EP_PROCEDURES.first_or_redo',
  'AF_ABLATIONS.pvi_block_confirmation',
  'AF_ABLATIONS.pvi_or_reisolation_attempted',
  'AF_ABLATIONS.pv_status_at_case_end',
  'AF_ABLATIONS.pv_reconnection_present_at_redo',
  'AF_ABLATIONS.reconnected_pv_count',
];

const blank = (v: unknown) => v === null || v === undefined || v === '';
const yes = (v: unknown) => v === true || v === 1 || v === '1' || String(v).toUpperCase() === 'TRUE';
const no = (v: unknown) => v === false || v === 0 || v === '0' || String(v).toUpperCase() === 'FALSE';

/** CANON_AF_ENDPOINT_V1 (dictionary spec v1.6-rc, as in EP Workspace): an AF endpoint counts as acute success only when
 *  the PV requirement is met (FIRST: PVI attempted and all target PVs isolated; REDO: that, or the durable branch —
 *  nothing attempted, no reconnection confirmed, none present, no count) AND the block was confirmed. */
export function afGateOk(v: Record<string, unknown>): boolean {
  if (!['ENTRANCE', 'ENTRANCE_AND_EXIT'].includes(String(v['AF_ABLATIONS.pvi_block_confirmation']))) return false;
  const attempted = yes(v['AF_ABLATIONS.pvi_or_reisolation_attempted']);
  const reisolated = attempted && v['AF_ABLATIONS.pv_status_at_case_end'] === 'ALL_TARGET_PVS_ISOLATED';
  const durable =
    !attempted && v['AF_ABLATIONS.pv_status_at_case_end'] === 'NO_RECONNECTION_CONFIRMED' && no(v['AF_ABLATIONS.pv_reconnection_present_at_redo']) && blank(v['AF_ABLATIONS.reconnected_pv_count']);
  const redo = v['EP_PROCEDURES.first_or_redo'];
  return redo === 'FIRST' ? reisolated : redo === 'REDO' ? reisolated || durable : false;
}

/** Rows that exist when a case is created; anything else (or a typed value in them) means data collection started. */
const INITIAL: Record<string, string[]> = {
  PATIENT_IDENTIFIERS: ['patient_id', 'mrn'],
  PATIENTS: ['patient_id', 'enrollment_date', 'registry_basis'],
  EP_EPISODES: ['episode_id', 'patient_id', 'episode_start_date', 'episode_status'],
};

export function hasClinicalData(rec: CaseRecord): boolean {
  for (const [entity, rows] of Object.entries(rec.rows)) {
    for (const r of rows) {
      if (r._deleted) continue;
      const initial = INITIAL[entity];
      if (!initial) return true;
      if (Object.entries(r).some(([k, v]) => !k.startsWith('_') && !initial.includes(k) && !blank(v))) return true;
    }
  }
  return false;
}

type Stage = 'COMPLETED' | 'STARTED' | 'MRN_ONLY';
export function stageOf(rec: CaseRecord): Stage {
  if (rec.meta.collection_status === 'COMPLETED') return 'COMPLETED';
  return hasClinicalData(rec) ? 'STARTED' : 'MRN_ONLY';
}

export function isStale(rec: CaseRecord, now: Date, days: number): boolean {
  if (rec.meta.collection_status === 'COMPLETED') return false;
  const t = Date.parse(rec.meta.updated_at || rec.meta.created_at);
  return Number.isFinite(t) && now.getTime() - t > days * DAY;
}

/** The person collecting a case: the first person who edited it, else the one who added it. */
export const collectorOf = (rec: CaseRecord) => rec.meta.collector_user_id ?? rec.meta.created_by;

interface Tally {
  total: number;
  completed: number;
  started: number;
  mrn_only: number;
  stale: number;
}
const tally = (): Tally => ({ total: 0, completed: 0, started: 0, mrn_only: 0, stale: 0 });

const month = (v: unknown): string | null => {
  const m = /^(\d{4})-(\d{2})/.exec(String(v ?? ''));
  return m ? `${m[1]}-${m[2]}` : null;
};

interface ProcView {
  categories: string[];
  values: Record<string, unknown>;
}

/** Each procedure of a case with its categories and the "ENTITY.field" values the counts read. */
function proceduresOf(dict: Dictionary, rows: Record<string, DecodedRow[]>): ProcView[] {
  return (rows.EP_PROCEDURES ?? []).map((p) => {
    const values: Record<string, unknown> = {};
    for (const [entity, list] of Object.entries(rows)) {
      const r = entity === 'EP_PROCEDURES' ? p : dict.entities[entity]?.scope === 'procedure' && dict.entities[entity].cardinality === 'single' ? list.find((x) => x.procedure_id === p._id) : undefined;
      if (r) for (const [k, v] of Object.entries(r)) if (!k.startsWith('_')) values[`${entity}.${k}`] = v;
    }
    const comps = (rows.PROCEDURE_COMPONENTS ?? []).filter((c) => c.procedure_id === p._id).map((c) => String(c.component_type));
    return { categories: categoriesOf(dict, comps), values };
  });
}

export function buildDashboard(dict: Dictionary, site: Site & { dashboard: DashConfig }, input: { cases: CaseRecord[]; groups: Group[]; users: User[]; basis: 'COMPLETED' | 'ALL'; now: Date }) {
  const d = site.dashboard;
  const live = input.cases.filter((c) => !c.meta.is_deleted);
  const userName = new Map(input.users.map((u) => [u.user_id, u.display_name]));
  const catLabel = (id: string) => dict.layout.category_labels?.[id] ?? id;
  const catIds = Object.keys(dict.layout.core_categories).filter((k) => !k.startsWith('_'));
  const decoded = new Map(live.map((c) => [c.meta.case_id, decodeRows(dict, c)]));
  const procs = new Map(live.map((c) => [c.meta.case_id, proceduresOf(dict, decoded.get(c.meta.case_id)!)]));

  // ── Progress (all live cases) ──
  const totals = tally();
  const byGroup = new Map<string, Tally>();
  const byCollector = new Map<string, Tally>();
  const add = (t: Tally, c: CaseRecord, stale: boolean) => {
    t.total++;
    const s = stageOf(c);
    if (s === 'COMPLETED') t.completed++;
    else if (s === 'STARTED') t.started++;
    else t.mrn_only++;
    if (stale) t.stale++;
  };
  for (const c of live) {
    const stale = isStale(c, input.now, d.stale_days);
    add(totals, c, stale);
    if (!byGroup.has(c.meta.group_id)) byGroup.set(c.meta.group_id, tally());
    add(byGroup.get(c.meta.group_id)!, c, stale);
    const who = collectorOf(c);
    if (!byCollector.has(who)) byCollector.set(who, tally());
    add(byCollector.get(who)!, c, stale);
  }
  const groupsOrdered = input.groups.filter((g) => byGroup.has(g.group_id));
  const byCategory = catIds.map((id) => {
    const cs = live.filter((c) => procs.get(c.meta.case_id)!.some((p) => p.categories.includes(id)));
    return { id, label: catLabel(id), total: cs.length, completed: cs.filter((c) => c.meta.collection_status === 'COMPLETED').length };
  });

  // ── Clinical counts (per procedure; Completed cases by default) ──
  const basisCases = input.basis === 'ALL' ? live : live.filter((c) => c.meta.collection_status === 'COMPLETED');
  const basisProcs = basisCases.flatMap((c) => procs.get(c.meta.case_id)!);
  const months = new Set<string>();
  const byType = catIds.map((id) => {
    const ps = basisProcs.filter((p) => p.categories.includes(id));
    const perMonth: Record<string, number> = {};
    let noDate = 0;
    for (const p of ps) {
      const mo = month(p.values[d.procedure_date_field]);
      if (mo) {
        perMonth[mo] = (perMonth[mo] ?? 0) + 1;
        months.add(mo);
      } else noDate++;
    }
    return { id, label: catLabel(id), procedures: ps.length, by_month: perMonth, no_date: noDate };
  });
  const acute = Object.entries(d.acute_success).map(([catId, rule]) => {
    const ps = basisProcs.filter((p) => p.categories.includes(catId));
    let success = 0;
    let other = 0;
    let notCounted = 0;
    let missing = 0;
    let undetermined = 0;
    for (const p of ps) {
      const v = p.values[rule.field];
      if (blank(v)) missing++;
      else if (rule.not_counted?.includes(String(v))) notCounted++;
      else if (rule.success.includes(String(v))) {
        if (rule.gate === 'CANON_AF_ENDPOINT_V1' && !afGateOk(p.values)) undetermined++;
        else success++;
      } else other++;
    }
    const counted = success + other;
    return { id: catId, label: catLabel(catId), field: rule.field, procedures: ps.length, success, not_success: other, not_counted: notCounted, not_recorded: missing, not_determined: undetermined, pct: counted ? Math.round((1000 * success) / counted) / 10 : null };
  });
  let present = 0;
  let reviewed = 0;
  let notReviewed = 0;
  for (const p of basisProcs) {
    const v = String(p.values[d.complications_field] ?? '');
    if (d.complications_reviewed_codes.includes(v)) {
      reviewed++;
      if (v === d.complications_present_code) present++;
    } else notReviewed++;
  }
  // Owner step 7: Hajj season (1 Dhu al-Qa'dah → 15 Muharram, by procedure date) against the rest of the year.
  const season = dict.layout.form?.hajj_season;
  const seasonOf = (p: (typeof basisProcs)[number]) => {
    const v = p.values[d.procedure_date_field];
    if (blank(v) || !season) return null;
    return inHajjSeason(String(v).slice(0, 10), season) ? 'hajj' : 'rest';
  };
  const hajjSplit = catIds.map((id) => {
    const ps = basisProcs.filter((p) => p.categories.includes(id));
    return { id, label: catLabel(id), hajj: ps.filter((p) => seasonOf(p) === 'hajj').length, rest: ps.filter((p) => seasonOf(p) === 'rest').length, no_date: ps.filter((p) => seasonOf(p) === null).length };
  });
  const compSplit = { hajj: { reviewed: 0, present: 0 }, rest: { reviewed: 0, present: 0 } };
  for (const p of basisProcs) {
    const s = seasonOf(p);
    const v = String(p.values[d.complications_field] ?? '');
    if (!s || !d.complications_reviewed_codes.includes(v)) continue;
    compSplit[s].reviewed++;
    if (v === d.complications_present_code) compSplit[s].present++;
  }
  // Cases by month of the episode start (all live cases), Completed vs In progress.
  const byMonth = new Map<string, { completed: number; in_progress: number }>();
  for (const c of live) {
    const mo = month(decoded.get(c.meta.case_id)!.EP_EPISODES?.[0]?.episode_start_date);
    if (!mo) continue;
    const m = byMonth.get(mo) ?? { completed: 0, in_progress: 0 };
    if (c.meta.collection_status === 'COMPLETED') m.completed++;
    else m.in_progress++;
    byMonth.set(mo, m);
  }
  const [pe, pf] = d.pilgrim_field.split('.');
  const pilgrim: Record<string, number> = { HAJJ: 0, UMRAH: 0, NON_PILGRIM: 0, UNKNOWN: 0, not_recorded: 0 };
  for (const c of basisCases) {
    const v = decoded.get(c.meta.case_id)![pe]?.[0]?.[pf];
    if (blank(v)) pilgrim.not_recorded++;
    else pilgrim[String(v)] = (pilgrim[String(v)] ?? 0) + 1;
  }

  return {
    generated_at: input.now.toISOString(),
    stale_days: d.stale_days,
    progress: {
      ...totals,
      in_progress: totals.started + totals.mrn_only,
      groups: groupsOrdered.length,
      collectors: byCollector.size,
      by_group: groupsOrdered.map((g) => ({ group_id: g.group_id, name: g.name, ...byGroup.get(g.group_id)! })),
      by_collector: [...byCollector.entries()].map(([id, t]) => ({ name: userName.get(id) ?? 'Unknown user', ...t })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
      by_category: byCategory,
      by_month: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, v]) => ({ month: m, ...v })),
    },
    clinical: {
      basis: input.basis,
      cases: basisCases.length,
      procedures: basisProcs.length,
      months: [...months].sort(),
      by_type: byType,
      acute_success: acute,
      complications: { reviewed, present, not_reviewed: notReviewed, pct: reviewed ? Math.round((1000 * present) / reviewed) / 10 : null },
      pilgrim,
      hajj_split: hajjSplit,
      complications_split: compSplit,
    },
  };
}

// ── My work (every user: their own cases) ──

/** Local calendar day (YYYY-MM-DD) of an instant in the site's time zone. */
export function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** First day (Sunday, the Saudi work week) of the week that holds `now`, as YYYY-MM-DD in the site's time zone. */
export function weekStart(now: Date, timeZone: string): string {
  const [y, m, d] = localDay(now, timeZone).split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  day.setUTCDate(day.getUTCDate() - day.getUTCDay());
  return day.toISOString().slice(0, 10);
}

export function buildMyWork(dict: Dictionary, site: Site & { dashboard: DashConfig }, input: { mine: CaseRecord[]; groups: Group[]; now: Date; maxMissing?: number; doneThisWeek?: number }) {
  const d = site.dashboard;
  const groupName = new Map(input.groups.map((g) => [g.group_id, g.name]));
  const max = input.maxMissing ?? 6;
  const items = input.mine.map((c) => {
    const r: Readiness = readinessOf(dict, c);
    const missing = r.blockers.map((b) => b.text.replace(/ is empty$/, ''));
    const stale = isStale(c, input.now, d.stale_days);
    const ready = c.meta.collection_status === 'IN_PROGRESS' && r.canComplete;
    return {
      case_id: c.meta.case_id,
      group_name: groupName.get(c.meta.group_id) ?? null,
      group_seq: c.meta.group_seq,
      mrn: c.meta.mrn,
      collection_status: c.meta.collection_status,
      stage: stageOf(c),
      core_done: r.done,
      core_total: r.total,
      missing_count: r.total - r.done,
      updated_at: c.meta.updated_at,
      stale,
      ready,
      missing: missing.slice(0, max),
      missing_more: Math.max(0, missing.length - max),
    };
  });
  const open = items.filter((x) => x.collection_status === 'IN_PROGRESS');
  // Owner, 28 Oct (step 5): fewest missing first; ready to complete before the rest at the same count.
  open.sort((a, b) => a.missing_count - b.missing_count || Number(b.ready) - Number(a.ready) || a.updated_at.localeCompare(b.updated_at));
  const reminders: { kind: string; text: string; count: number }[] = [];
  const n = (f: (x: (typeof items)[number]) => boolean) => open.filter(f).length;
  const push = (kind: string, count: number, one: string, many: string) => {
    if (count) reminders.push({ kind, count, text: count === 1 ? one : many.replace('{n}', String(count)) });
  };
  push('ready', n((x) => x.ready), '1 case looks complete — check it and mark it Completed.', '{n} cases look complete — check them and mark them Completed.');
  push('stale', n((x) => x.stale), `1 case has not changed for more than ${d.stale_days} days.`, `{n} cases have not changed for more than ${d.stale_days} days.`);
  push('mrn_only', n((x) => x.stage === 'MRN_ONLY'), '1 case has only the MRN so far.', '{n} cases have only the MRN so far.');
  return {
    generated_at: input.now.toISOString(),
    stale_days: d.stale_days,
    totals: { mine: items.length, in_progress: open.length, completed: items.length - open.length, ready: open.filter((x) => x.ready).length, done_this_week: input.doneThisWeek ?? 0 },
    reminders,
    items: open,
  };
}
