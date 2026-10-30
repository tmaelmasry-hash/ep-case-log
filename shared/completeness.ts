// Data completeness for a whole group (R4-8, Admin): the core checks of shared/readiness.ts counted per case section.
// No second rules engine: every count comes from evaluateReadiness's checks. Pure: used by the server endpoint.
import type { Dictionary } from './dictionary.ts';
import type { CoreCheck } from './readiness.ts';

export const COMPLETENESS_SECTIONS = [
  { id: 'patient', label: 'Patient' },
  { id: 'history', label: 'History' },
  { id: 'studies', label: 'Studies' },
  { id: 'procedure', label: 'Procedure' },
  { id: 'complications', label: 'Complications' },
  { id: 'followup', label: 'Follow-up' },
] as const;
export type CompletenessSection = (typeof COMPLETENESS_SECTIONS)[number]['id'];

export interface SectionCount {
  applicable: number;
  recorded: number;
  not_available: number;
  missing: number;
  ai_pending: number;
}

export interface Completeness {
  sections: Record<CompletenessSection, SectionCount>;
  /** answered = recorded + not available with a reason (as readiness "done"). */
  core: { answered: number; applicable: number };
}

/** Case-page layout groups (config/case_layout.json) → matrix column; the "patient" row has its own column. */
const LAYOUT_GROUP: Record<string, CompletenessSection> = { history: 'history', investigations: 'studies', follow: 'followup' };
/** Procedure-level entities shown under Complications rather than Procedure. */
const COMPLICATION_ENTITIES = ['EXT_PROCEDURE_REVIEW', 'COMPLICATIONS'];

export function completenessSectionOf(dict: Dictionary, check: Pick<CoreCheck, 'entity' | 'section' | 'procedure_id'>): CompletenessSection {
  if (check.procedure_id !== null || check.section === 'procedure') return COMPLICATION_ENTITIES.includes(check.entity) ? 'complications' : 'procedure';
  if (check.section === 'patient') return 'patient';
  const g = dict.layout.groups.find((x) => x.rows.some((r) => r.id === check.section));
  return (g && LAYOUT_GROUP[g.id]) || 'history';
}

export function completenessOf(dict: Dictionary, checks: CoreCheck[]): Completeness {
  const sections = Object.fromEntries(COMPLETENESS_SECTIONS.map((s) => [s.id, { applicable: 0, recorded: 0, not_available: 0, missing: 0, ai_pending: 0 }])) as Record<CompletenessSection, SectionCount>;
  for (const c of checks) {
    if (c.state === 'not_applicable') continue;
    const t = sections[completenessSectionOf(dict, c)];
    t.applicable++;
    if (c.state === 'ok') t.recorded++;
    else if (c.state === 'not_available') t.not_available++;
    else if (c.state === 'ai_pending') t.ai_pending++;
    else t.missing++;
  }
  const all = Object.values(sections);
  const sum = (k: keyof SectionCount) => all.reduce((n, s) => n + s[k], 0);
  return { sections, core: { answered: sum('recorded') + sum('not_available'), applicable: sum('applicable') } };
}
