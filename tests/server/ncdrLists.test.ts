// Q-S1 (31 Oct): printed NCDR dynamic-list values (docs/NCDR_LISTS_Q-S1.md) — two AF symptoms, Ethanol among the
// energies used, prior AF ablation strategies for a redo, LV hypertrophy and RA size on the echo. Additions only.
// Synthetic MRNs (9990xxx) and synthetic accounts only.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../server/dictionary.ts';
import { applyEdits, expectedSlot, newCaseRecord } from '../../server/domain/cases.ts';
import { idPrefix, type CaseRecord } from '../../shared/caseTypes.ts';

const { dict } = loadConfig();
const field = (e: string, f: string) => dict.entities[e].fields.find((x) => x.name === f)!;
const codes = (e: string, f: string) => field(e, f).codes!.map((c) => c.code);
const names = (e: string) => dict.entities[e].fields.map((f) => f.name);
const rid = (entity: string) => `${idPrefix(dict.entities[entity].pk)}_${crypto.randomUUID()}`;
const a = { userId: 'u1', now: '2026-10-31T12:00:00Z' };
const users = new Set(['u1']);

function afCase(firstOrRedo: string) {
  const rec = newCaseRecord(dict, { caseId: `case_${crypto.randomUUID()}`, patientId: `patient_${crypto.randomUUID()}`, mrn: '9990451', groupId: 'grp_1', groupSeq: 1, episodeStart: '2026-10-01', enrollmentDate: '2026-10-31', registryBasis: 'CLINICAL_QI' }, a);
  const pid = rid('EP_PROCEDURES');
  const af = expectedSlot(dict, 'AF_ABLATIONS', pid);
  const res = applyEdits(
    dict,
    rec,
    {
      creates: [
        { entity: 'EP_PROCEDURES', id: pid, values: { primary_procedure_type: 'ABLATION', first_or_redo: firstOrRedo } },
        { entity: 'PROCEDURE_COMPONENTS', id: rid('PROCEDURE_COMPONENTS'), parent_id: pid, values: { component_type: 'AF' } },
        { entity: 'AF_ABLATIONS', id: af, parent_id: pid },
      ],
    },
    a,
    users,
  );
  expect(res.every((r) => r.ok), JSON.stringify(res)).toBe(true);
  return { rec, af };
}
const set = (rec: CaseRecord, af: string, f: string, value: unknown) => applyEdits(dict, rec, { changes: [{ entity: 'AF_ABLATIONS', id: af, field: f, value }] }, a, users)[0];

describe('Q-S1 NCDR lists', () => {
  it('presentation gains Anxiety and Irregular heartbeat; the old codes stay first and unchanged', () => {
    expect(codes('ARRHYTHMIA_INDICATIONS', 'presentation')).toEqual(['PALPITATIONS', 'DYSPNEA', 'FATIGUE', 'CHEST_PAIN', 'PRESYNCOPE', 'SYNCOPE', 'HF', 'CARDIAC_ARREST', 'ASYMPTOMATIC', 'ANXIETY', 'IRREGULAR_HEARTBEAT']);
  });

  it('energies used gains Ethanol; the single energy source is unchanged', () => {
    expect(codes('AF_ABLATIONS', 'af_energy_sources_used')).toEqual(['RF', 'CRYOBALLOON', 'PFA', 'LASER', 'OTHER', 'ETHANOL']);
    expect(codes('AF_ABLATIONS', 'af_energy_source')).toEqual(['RF', 'CRYOBALLOON', 'PFA', 'LASER', 'MULTIPLE', 'OTHER']);
  });

  it('prior AF ablation strategies: the 11 printed NCDR values, right after the last prior catheter ablation date', () => {
    const n = names('AF_ABLATIONS');
    expect(n[n.indexOf('last_prior_af_catheter_ablation_date') + 1]).toBe('prior_af_ablation_strategies');
    expect(field('AF_ABLATIONS', 'prior_af_ablation_strategies')).toMatchObject({ type: 'lookup_array', req: 'O' });
    expect(field('AF_ABLATIONS', 'prior_af_ablation_strategies').codes!.map((c) => c.label)).toEqual([
      'Complex fractionated atrial electrogram', 'Convergent procedure', 'Cryoablation', 'Empiric LA linear lesions', 'Focal ablation', 'Ganglion plexus ablation',
      'Pulmonary vein isolation', 'PFA (pulsed field)', 'Rotor based mapping', 'Segmental PV ablation', 'Wide area circumferential ablation',
    ]);
  });

  it('prior strategies are asked for a redo only', () => {
    const redo = afCase('REDO');
    expect(set(redo.rec, redo.af, 'prior_af_ablation_strategies', ['PVI', 'EMPIRIC_LA_LINES'])).toMatchObject({ ok: true });
    const first = afCase('FIRST');
    expect(set(first.rec, first.af, 'prior_af_ablation_strategies', ['PVI'])).toMatchObject({ ok: false, message: expect.stringMatching(/does not apply/) });
  });

  it('echo gains LV hypertrophy (after RV function) and RA size (after the LA volume index), both optional', () => {
    const n = names('ECHO_STUDIES');
    expect(n[n.indexOf('rv_function') + 1]).toBe('lv_hypertrophy');
    expect(n[n.indexOf('la_volume_index_ml_m2') + 1]).toBe('ra_size_category');
    expect(field('ECHO_STUDIES', 'lv_hypertrophy')).toMatchObject({ type: 'enum', req: 'O' });
    expect(codes('ECHO_STUDIES', 'lv_hypertrophy')).toEqual(['NONE', 'MILD', 'MODERATE', 'SEVERE', 'UNKNOWN']);
    expect(codes('ECHO_STUDIES', 'ra_size_category')).toEqual(codes('ECHO_STUDIES', 'la_size_category'));
  });
});
