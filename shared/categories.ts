// Sidebar categories (owner R2-4 / R2-5): which cases each menu item holds. Pure, shared by server and browser.
// The server lists, per case and per procedure, the codes of CATEGORY_FIELDS (summarize in server/domain/cases.ts);
// the browser matches them against config/categories.json. Nothing here is stored.
import type { CaseSummary, ProcedureSummary } from './caseTypes.ts';

/** Fields a menu item may test ("ENTITY.field"). Their codes travel with each case summary. */
export const CATEGORY_FIELDS = [
  'EP_PROCEDURES.first_or_redo',
  'FLUTTER_ABLATIONS.flutter_type',
  'SVT_ABLATIONS.svt_mechanism',
  'SVT_ABLATIONS.accessory_pathway_manifestation',
  'VENTRICULAR_ABLATIONS.va_type',
  'VENTRICULAR_ABLATIONS.structural_substrate',
  'VENTRICULAR_ABLATIONS.dominant_origin_or_substrate_location',
  'CRT_CSP_PROCEDURES.cpp_strategy',
  'LEAD_PROCEDURES.lead_management_type',
  'DEVICE_IMPLANTS.device_action',
  'EXT_PROCEDURE_REVIEW.complications_reviewed',
  'DEVICES.current_device_type',
  'EP_EPISODES.pilgrim_status',
] as const;

export type Cond =
  | { component: string[] }
  | { type: string[] }
  | { field: string; in: string[] }
  | { field: string; missing: true }
  | { derived: 'incomplete' | 'followup_due' | 'followup_overdue' }
  | { ref: string }
  | { any_proc: Cond }
  | { all: Cond[] }
  | { any: Cond[] };

export interface CategoryItem {
  id: string;
  label: string;
  section: 'procedures' | 'groups';
  parent?: string;
  icon?: string;
  /** CSS color token without "--" (styles.css), e.g. cat-af. */
  color?: string;
  match?: { proc?: Cond; case?: Cond };
  /** Children by Hijri year of the episode date; "hajj" counts Muharram toward the previous year's season (R2-5). */
  years?: 'hijri' | 'hajj';
  /** false: its cases are not counted in the parent (owner 28 Oct: "Pilgrims" counts Hajj + Umrah only). */
  rollup?: boolean;
}

export interface CategoryConfig {
  pending_codes?: string[];
  items: CategoryItem[];
}

export const UNCLASSIFIED = 'UNCLASSIFIED';

const HIJRI = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });

/** Hijri (Umm al-Qura) year of a YYYY-MM-DD date; for Hajj, a Muharram date belongs to the season just ended. */
export function hijriYear(date: string | null, rule: 'hijri' | 'hajj'): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const parts = HIJRI.formatToParts(new Date(`${date.slice(0, 10)}T12:00:00Z`));
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  if (!year) return null;
  return rule === 'hajj' && month === 1 ? year - 1 : year;
}

interface Facts {
  codes: Set<string>;
  components: Set<string>;
  types: Set<string>;
}

function hasField(codes: Set<string>, field: string) {
  const p = `${field}=`;
  for (const c of codes) if (c.startsWith(p)) return true;
  return false;
}

export class CategoryMatcher {
  readonly items: CategoryItem[];
  private byId = new Map<string, CategoryItem>();
  private kids = new Map<string, CategoryItem[]>();

  constructor(cfg: CategoryConfig) {
    this.items = cfg.items;
    for (const it of cfg.items) {
      this.byId.set(it.id, it);
      if (it.parent) this.kids.set(it.parent, [...(this.kids.get(it.parent) ?? []), it]);
    }
  }

  item(id: string) {
    return this.byId.get(id);
  }
  children(id: string | null) {
    return id === null ? this.items.filter((i) => !i.parent) : (this.kids.get(id) ?? []);
  }

  private test(c: Cond, f: Facts, s: CaseSummary, procs: Facts[]): boolean {
    if ('all' in c) return c.all.every((x) => this.test(x, f, s, procs));
    if ('any' in c) return c.any.some((x) => this.test(x, f, s, procs));
    if ('component' in c) return c.component.some((x) => f.components.has(x));
    if ('type' in c) return c.type.some((x) => f.types.has(x));
    if ('missing' in c) return !hasField(f.codes, c.field);
    if ('in' in c) return c.in.some((x) => f.codes.has(`${c.field}=${x}`));
    if ('ref' in c) {
      const p = this.byId.get(c.ref)?.match?.proc;
      return !!p && this.test(p, f, s, procs);
    }
    if ('any_proc' in c) return procs.some((p) => this.test(c.any_proc, p, s, procs));
    if (c.derived === 'incomplete') return s.collection_status === 'IN_PROGRESS' && !!s.core && s.core.done < s.core.total;
    if (c.derived === 'followup_due') return s.followup === 'DUE';
    return s.followup === 'OVERDUE';
  }

  /** Every item id the case belongs to (parents included), plus year children ("HAJJ@1447") and Unclassified. */
  tagsOf(s: CaseSummary): Set<string> {
    const procs: Facts[] = s.procedures.map((p: ProcedureSummary) => ({
      codes: new Set(p.codes ?? []),
      components: new Set(p.components),
      types: new Set(p.type ? [p.type] : []),
    }));
    const whole: Facts = { codes: new Set(s.codes ?? []), components: new Set(), types: new Set() };
    const tags = new Set<string>();
    const own = (it: CategoryItem) =>
      !!it.match && ((!!it.match.proc && procs.some((p) => this.test(it.match!.proc!, p, s, procs))) || (!!it.match.case && this.test(it.match.case, whole, s, procs)));
    const visit = (it: CategoryItem): boolean => {
      let hit = own(it);
      for (const k of this.kids.get(it.id) ?? []) if (visit(k) && k.rollup !== false) hit = true;
      if (hit) {
        tags.add(it.id);
        if (it.years) {
          const y = hijriYear(s.episode_start_date, it.years);
          if (y) tags.add(`${it.id}@${y}`);
        }
      }
      return hit;
    };
    for (const root of this.children(null)) visit(root);
    if (!this.items.some((i) => i.section === 'procedures' && tags.has(i.id))) tags.add(UNCLASSIFIED);
    return tags;
  }

  /** Year children of a "years" item, newest first, from the cases at hand. */
  yearsOf(id: string, tagged: Set<string>[]): number[] {
    const ys = new Set<number>();
    const p = `${id}@`;
    for (const t of tagged) for (const x of t) if (x.startsWith(p)) ys.add(Number(x.slice(p.length)));
    return [...ys].sort((a, b) => b - a);
  }

  /** Start-up / test check: every field is reported by the server and every code exists (or is a pending M-3 code). */
  check(codeExists: (field: string, code: string) => boolean, pending: string[] = []): string[] {
    const errs: string[] = [];
    const seen = new Set<string>();
    const fieldOk = (field: string) => (CATEGORY_FIELDS as readonly string[]).includes(field) || errs.push(`${field} is not in CATEGORY_FIELDS`);
    const code = (field: string, x: string) => codeExists(field, x) || pending.includes(`${field}=${x}`) || errs.push(`${field}=${x} is not a dictionary code`);
    const walk = (c: Cond, id: string) => {
      if ('all' in c) c.all.forEach((x) => walk(x, id));
      else if ('any' in c) c.any.forEach((x) => walk(x, id));
      else if ('any_proc' in c) walk(c.any_proc, id);
      else if ('ref' in c) this.byId.has(c.ref) || errs.push(`${id}: ref ${c.ref} is not an item`);
      else if ('component' in c) c.component.forEach((x) => code('PROCEDURE_COMPONENTS.component_type', x));
      else if ('type' in c) c.type.forEach((x) => code('EP_PROCEDURES.primary_procedure_type', x));
      else if ('in' in c) {
        fieldOk(c.field);
        c.in.forEach((x) => code(c.field, x));
      } else if ('missing' in c) fieldOk(c.field);
    };
    for (const it of this.items) {
      if (seen.has(it.id)) errs.push(`duplicate id ${it.id}`);
      seen.add(it.id);
      if (it.parent && !this.byId.has(it.parent)) errs.push(`${it.id}: parent ${it.parent} is not an item`);
      if (it.match?.proc) walk(it.match.proc, it.id);
      if (it.match?.case) walk(it.match.case, it.id);
    }
    return errs;
  }
}
