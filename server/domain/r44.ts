// R4-4 (owner 30 Oct 2026, docs/MERGE_PLAN.md): several pacing reasons and generator-replacement reasons are two new
// multi-choice fields beside the unchanged DEVICE_IMPLANTS.implant_indication. Old cases get a reason only where the
// old single value means exactly the same NCDR reason; everything else stays empty (never guessed). The old field is
// never changed. Writes go through applyEdits (validation, show rules, history) only while the new field is empty;
// an AI value nobody accepted and deleted cases / rows are left. Dry run unless `apply`.
import type { CaseRecord } from '../../shared/caseTypes.ts';
import type { Dictionary } from '../../shared/dictionary.ts';
import type { RegistryStore } from '../store/types.ts';
import { StaleCaseError } from '../store/types.ts';
import { applyEdits } from './cases.ts';

const E = 'DEVICE_IMPLANTS';
export const R44_ACTOR = 'migration:R4-4';

/** Old implant_indication → [new field, NCDR reason]: exact matches only. */
export const R44_MAP: Record<string, [string, string]> = {
  REPLACEMENT_ERI_EOL: ['generator_replacement_reasons', 'END_OF_BATTERY_LIFE'],
  POST_AVJ_ABLATION: ['pacing_indication_reasons', 'AV_NODE_ABLATION'],
  SND: ['pacing_indication_reasons', 'SICK_SINUS_SYNDROME'],
};

export interface R44Item {
  case_id: string;
  row_id: string;
  old: string;
  field: string;
  outcome: 'fill' | 'nothing_to_do' | 'ai_not_accepted' | 'rule_hides' | 'stale';
  message?: string;
}

const empty = (v: unknown) => v === null || v === undefined || v === '' || v === '[]';

export async function migrateR44(dict: Dictionary, store: RegistryStore, opts: { apply: boolean; now?: () => Date }): Promise<R44Item[]> {
  const out: R44Item[] = [];
  const now = opts.now ?? (() => new Date());
  for (const c of await store.listCases()) {
    if (c.meta.is_deleted) continue;
    const rec: CaseRecord = structuredClone(c);
    const base = structuredClone(c);
    const changes: { entity: string; id: string; field: string; value: string[] }[] = [];
    const mine: R44Item[] = [];
    for (const row of rec.rows[E] ?? []) {
      if (row._deleted) continue;
      const old = String(row.implant_indication ?? '');
      const map = R44_MAP[old];
      if (!map) continue;
      const [field, code] = map;
      const item: R44Item = { case_id: rec.meta.case_id, row_id: row._id, old, field, outcome: 'nothing_to_do' };
      mine.push(item);
      const ai = rec.ai ?? {};
      if (ai[`${E}|${row._id}|implant_indication`] || ai[`${E}|${row._id}|implant_indication#ai`]) item.outcome = 'ai_not_accepted';
      else if (empty(row[field])) {
        item.outcome = 'fill';
        changes.push({ entity: E, id: row._id, field, value: [code] });
      }
    }
    out.push(...mine);
    if (!changes.length) continue;
    // Show rules are checked here too, so a dry run already says which ones a rule would refuse.
    const results = applyEdits(dict, rec, { changes }, { userId: R44_ACTOR, now: now().toISOString() }, new Set());
    const fills = mine.filter((x) => x.outcome === 'fill');
    results.forEach((r, i) => {
      if (!r.ok) Object.assign(fills[i], { outcome: 'rule_hides', message: r.message });
    });
    if (!opts.apply || !results.some((r) => r.ok)) continue;
    const fields = [...new Set(fills.filter((x) => x.outcome === 'fill').map((x) => `${E}.${x.field}`))];
    try {
      await store.putCase(rec, base, [{ actor: R44_ACTOR, action: 'case.edit', detail: { case_id: rec.meta.case_id, fields, migration: 'R4-4' } }]);
    } catch (e) {
      if (!(e instanceof StaleCaseError)) throw e;
      for (const x of fills) if (x.outcome === 'fill') x.outcome = 'stale'; // saved by someone meanwhile: run again
    }
  }
  return out;
}
