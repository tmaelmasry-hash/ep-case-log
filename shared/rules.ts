// Dynamic-form rules (EP Workspace merge step M-1, config/rules.json copied unchanged): one evaluator for the browser
// and the server, so the screen and the save check can never disagree. Ported from EP Workspace public/js/rules.js.
// Here a case has several procedures: a rule about a procedure-level field reads that procedure's own rows and
// components; case-level fields read the case's row.
//
// A predicate answers true, false or null (= unknown: a field it reads is blank). Blank is never read as No.
//   show_when  — the field is shown and applies only when the predicate is true.
//   offer_when — the code `code` is offered only when the predicate is not false (unknown keeps it offered).
//   warn_when  — `message` is shown under the field when the predicate is true (saving is never blocked).
//   min        — a number below `value` is refused.
import type { EntityDef } from './dictionary.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Predicate = any;

export interface Rule {
  id: string;
  target: string;
  effect: 'show_when' | 'offer_when' | 'warn_when' | 'min';
  when?: Predicate;
  code?: string;
  message?: string;
  value?: number;
  source?: string;
  status?: string;
}

export interface RulesConfig {
  version?: string;
  enabled?: boolean;
  rules?: Rule[];
}

export interface CompiledRules {
  byTarget: Map<string, Rule[]>;
  /** "E.f" → targets whose rules read it. */
  dependents: Map<string, Set<string>>;
}

/** Reads values for the evaluator: decoded (booleans true/false, lists as arrays). */
export interface RuleEnv {
  get(entity: string, field: string): unknown;
  components(): string[];
}

const blank = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

export function readsOf(p: Predicate): string[] {
  if (!p || typeof p !== 'object') return [];
  if (p.all) return p.all.flatMap(readsOf);
  if (p.any) return p.any.flatMap(readsOf);
  if (p.not) return readsOf(p.not);
  const out: string[] = [];
  if (p.field) out.push(p.field);
  if (p.same_day_as) out.push(p.same_day_as);
  return out;
}

export function compileRules(cfg: RulesConfig | undefined): CompiledRules {
  const byTarget = new Map<string, Rule[]>();
  const dependents = new Map<string, Set<string>>();
  if (!cfg?.enabled) return { byTarget, dependents };
  const dep = (k: string, t: string) => (dependents.get(k) ?? dependents.set(k, new Set()).get(k)!).add(t);
  for (const r of cfg.rules ?? []) {
    byTarget.set(r.target, [...(byTarget.get(r.target) ?? []), r]);
    for (const p of readsOf(r.when)) dep(p, r.target);
    if (r.when && JSON.stringify(r.when).includes('"component"')) dep('PROCEDURE_COMPONENTS.component_type', r.target);
  }
  return { byTarget, dependents };
}

export function evaluate(p: Predicate, env: RuleEnv): boolean | null {
  if (p === true || p === false) return p;
  if (p.all) {
    const r = p.all.map((x: Predicate) => evaluate(x, env));
    return r.includes(false) ? false : r.includes(null) ? null : true;
  }
  if (p.any) {
    const r = p.any.map((x: Predicate) => evaluate(x, env));
    return r.includes(true) ? true : r.includes(null) ? null : false;
  }
  if (p.not) {
    const r = evaluate(p.not, env);
    return r === null ? null : !r;
  }
  if (p.component) return env.components().some((c) => p.component.includes(c));
  const [e, f] = String(p.field).split('.');
  const v = env.get(e, f);
  if (blank(v)) return null;
  if (p.in) return Array.isArray(v) ? v.some((x) => p.in.includes(String(x))) : p.in.includes(String(v)); // multi-choice: any chosen
  if ('eq' in p) return v === p.eq || String(v) === String(p.eq);
  if ('count_lt' in p) return (Array.isArray(v) ? v.length : 1) < p.count_lt;
  if (p.same_day_as) {
    const [e2, f2] = String(p.same_day_as).split('.');
    const w = env.get(e2, f2);
    return blank(w) ? null : String(v).slice(0, 10) === String(w).slice(0, 10);
  }
  throw new Error(`Unknown rule predicate: ${JSON.stringify(p)}`);
}

export interface FieldRuling {
  visible: boolean;
  offered: (code: unknown) => boolean;
  warnings: { id: string; message: string }[];
  min?: number;
}

/** What the rules say about one field: shown?, which codes are offered, warnings, minimum. */
export function fieldRules(c: CompiledRules, entity: string, field: string, env: RuleEnv): FieldRuling {
  const rules = c.byTarget.get(`${entity}.${field}`) ?? [];
  let visible = true;
  const notOffered = new Set<string>();
  const warnings: { id: string; message: string }[] = [];
  let min: number | undefined;
  for (const r of rules) {
    if (r.effect === 'show_when' && evaluate(r.when, env) !== true) visible = false;
    if (r.effect === 'offer_when' && evaluate(r.when, env) === false) notOffered.add(String(r.code));
    if (r.effect === 'warn_when' && evaluate(r.when, env) === true) warnings.push({ id: r.id, message: r.message ?? '' });
    if (r.effect === 'min') min = r.value;
  }
  return { visible, offered: (code) => !notOffered.has(String(code)), warnings, min };
}

/** Why a value cannot stay in this field under the current answers, or null when it fits. */
export function misfit(c: CompiledRules, entity: string, field: string, value: unknown, env: RuleEnv): string | null {
  if (blank(value)) return null;
  const fr = fieldRules(c, entity, field, env);
  if (!fr.visible) return 'does not apply to the answers given';
  const list = Array.isArray(value) ? value : [value];
  if (list.some((x) => !fr.offered(x))) return 'does not fit the answers given';
  if (fr.min !== undefined && typeof value !== 'boolean' && Number(value) < fr.min) return `must be at least ${fr.min}`;
  return null;
}

type Row = Record<string, unknown> & { _id: string };

/**
 * Reads one case for the rules (decoded rows by entity). `procedureId` = the procedure whose fields are being looked at
 * (null for case-level fields): procedure-level entities are read from that procedure's own row, case-level ones from
 * the case's row; `own` = the row being edited (its entity is read from it). `overlay` ("E.f" → value) goes on top.
 */
export function caseEnv(entities: Record<string, EntityDef>, rows: (entity: string) => Row[], procedureId: string | null, own?: { entity: string; row: Row | null }, overlay: Record<string, unknown> = {}): RuleEnv {
  const rowOf = (e: string): Row | undefined => {
    if (own && own.entity === e && own.row) return own.row;
    const list = rows(e);
    if (e === 'EP_PROCEDURES') return list.find((r) => r._id === procedureId) ?? (procedureId ? undefined : list[0]);
    if (entities[e]?.scope === 'procedure') return procedureId ? list.find((r) => r.procedure_id === procedureId) : undefined;
    return list[0];
  };
  return {
    get(e, f) {
      if (`${e}.${f}` in overlay) return overlay[`${e}.${f}`];
      return rowOf(e)?.[f];
    },
    components() {
      const comps = rows('PROCEDURE_COMPONENTS');
      return (procedureId ? comps.filter((r) => r.procedure_id === procedureId) : comps).map((r) => String(r.component_type ?? '')).filter(Boolean);
    },
  };
}

export interface Consequence {
  entity: string;
  field: string;
  value: unknown;
  why: string;
}

/**
 * The answers (of the same procedure, or the case) that would stop fitting if `entity.field` became `value`.
 * Follows chains: a removed answer can make a further one not apply.
 */
export function consequences(c: CompiledRules, entities: Record<string, EntityDef>, rows: (entity: string) => Row[], procedureId: string | null, entity: string, field: string, value: unknown): Consequence[] {
  const overlay: Record<string, unknown> = { [`${entity}.${field}`]: value };
  const out: Consequence[] = [];
  const queue = [`${entity}.${field}`];
  const seen = new Set<string>();
  while (queue.length) {
    const trig = queue.shift()!;
    for (const target of c.dependents.get(trig) ?? []) {
      if (seen.has(target) || target in overlay) continue;
      const [te, tf] = target.split('.');
      // A procedure-level answer of another procedure is not affected by this procedure's change, and vice versa.
      const pid = entities[te]?.scope === 'procedure' || te === 'EP_PROCEDURES' ? procedureId : null;
      if ((entities[te]?.scope === 'procedure' || te === 'EP_PROCEDURES') && !procedureId) continue;
      const env = caseEnv(entities, rows, pid, undefined, overlay);
      const cur = env.get(te, tf);
      const why = misfit(c, te, tf, cur, env);
      if (why) {
        seen.add(target);
        overlay[target] = null;
        out.push({ entity: te, field: tf, value: cur, why });
        queue.push(target);
      }
    }
  }
  return out;
}

/** Start-up check: rules name only dictionary fields and codes (nothing invented). Returns the problems found. */
export function checkRules(cfg: RulesConfig | undefined, entities: Record<string, EntityDef>): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  const fieldOf = (path: string, where: string) => {
    const [e, f] = String(path).split('.');
    const def = entities[e]?.fields.find((x) => x.name === f);
    if (!def) errs.push(`config/rules.json ${where}: field ${path} does not exist in the dictionary`);
    return def;
  };
  const codesOf = (path: string) => {
    const [e, f] = String(path).split('.');
    const def = entities[e]?.fields.find((x) => x.name === f);
    return def?.type === 'boolean' ? ['true', 'false'] : (def?.codes ?? []).map((x) => x.code);
  };
  const walk = (p: Predicate, where: string): void => {
    if (!p || typeof p !== 'object') return;
    if (p.all || p.any) return (p.all ?? p.any).forEach((x: Predicate) => walk(x, where));
    if (p.not) return walk(p.not, where);
    if (p.component) {
      for (const k of p.component) if (!codesOf('PROCEDURE_COMPONENTS.component_type').includes(k)) errs.push(`config/rules.json ${where}: component ${k} is not a dictionary code`);
      return;
    }
    fieldOf(p.field, where);
    if (p.same_day_as) fieldOf(p.same_day_as, where);
    if (p.in) for (const k of p.in) if (!codesOf(p.field).includes(String(k))) errs.push(`config/rules.json ${where}: ${k} is not a code of ${p.field}`);
  };
  for (const r of cfg?.rules ?? []) {
    if (ids.has(r.id)) errs.push(`config/rules.json: repeated id ${r.id}`);
    ids.add(r.id);
    fieldOf(r.target, r.id);
    if (r.effect === 'offer_when' && !codesOf(r.target).includes(String(r.code))) errs.push(`config/rules.json ${r.id}: ${r.code} is not a code of ${r.target}`);
    walk(r.when, r.id);
  }
  return errs;
}
