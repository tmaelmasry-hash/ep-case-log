// Owner, 3 Nov 2026: Cardiac CT / CMR / TEE ask only their own questions (spec Prompt Library v1.6-rc §2.9: CMR,
// Cardiac CT and TEE field tables; LA/LAA thrombus result "CMR: NOT_APPLICABLE"; scar pattern / location "C if scar
// present"). Rules DR-IMG-*. Synthetic data only.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, dict, harness, newCase, rid, type Harness } from './harness.ts';
import { caseEnv, fieldRules } from '../../shared/rules.ts';

const COMMON = ['modality_code', 'study_date', 'indication_code'];
const CMR = ['cmr_lvef_pct', 'lge_scar_present', 'active_inflammation_or_infiltration'];
const SCAR = ['scar_pattern', 'scar_locations'];
const CT = ['pv_anatomy_variant_present', 'systemic_venous_stenosis_or_occlusion'];
const TEE = ['spontaneous_echo_contrast', 'significant_valve_or_shunt_finding', 'procedure_deferred_due_to_imaging'];

/** The shown ADVANCED_IMAGING questions of one study. */
function shown(row: Record<string, unknown>): string[] {
  const env = caseEnv(dict.entities, () => [], null, { entity: 'ADVANCED_IMAGING', row: { _id: 'i1', ...row } as never });
  return dict.entities.ADVANCED_IMAGING.fields.filter((f) => !f.hidden && !f.auto && f.type !== 'json_object' && f.type !== 'fk' && fieldRules(dict.rules, 'ADVANCED_IMAGING', f.name, env).visible).map((f) => f.name);
}
const sorted = (xs: string[]) => [...xs].sort();

describe('imaging questions follow the study type', () => {
  it('Cardiac CT: thrombus, PV anatomy and venous stenosis; no CMR or TEE questions', () => {
    expect(sorted(shown({ modality_code: 'CARDIAC_CT' }))).toEqual(sorted([...COMMON, 'la_laa_thrombus_result', ...CT]));
  });
  it('CMR: LVEF, LGE scar, inflammation; scar pattern and location only when scar is present; no thrombus result', () => {
    expect(sorted(shown({ modality_code: 'CMR' }))).toEqual(sorted([...COMMON, ...CMR]));
    expect(sorted(shown({ modality_code: 'CMR', lge_scar_present: 'NO' }))).toEqual(sorted([...COMMON, ...CMR]));
    expect(sorted(shown({ modality_code: 'CMR', lge_scar_present: 'YES' }))).toEqual(sorted([...COMMON, ...CMR, ...SCAR]));
  });
  it('TEE: thrombus, echo contrast, valve / shunt finding, deferred procedure', () => {
    expect(sorted(shown({ modality_code: 'TEE' }))).toEqual(sorted([...COMMON, 'la_laa_thrombus_result', ...TEE]));
  });
});

describe('Indication of Imaging', () => {
  const offered = (modality: string) => {
    const env = caseEnv(dict.entities, () => [], null, { entity: 'ADVANCED_IMAGING', row: { _id: 'i1', modality_code: modality } as never });
    return fieldRules(dict.rules, 'ADVANCED_IMAGING', 'indication_code', env).offered('LA_LAA_THROMBUS_EXCLUSION');
  };
  it('LA LAA Thrombus Exclusion is offered for Cardiac CT and TEE, not for CMR (owner, 4 Nov)', () => {
    expect([offered('CARDIAC_CT'), offered('TEE'), offered('CMR')]).toEqual([true, true, false]);
  });
});

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

describe('the server keeps to the same rules', () => {
  it('a CMR answer is refused on a Cardiac CT study; a CT answer is kept', async () => {
    const sara = await as(h, 'sara');
    const id = (await newCase(sara, '9990971')).case_id;
    const img = rid('ADVANCED_IMAGING');
    const res = await sara.call('PATCH', `/api/cases/${id}`, {
      creates: [{ entity: 'ADVANCED_IMAGING', id: img, values: { modality_code: 'CARDIAC_CT' } }],
      changes: [
        { entity: 'ADVANCED_IMAGING', id: img, field: 'lge_scar_present', value: 'YES' },
        { entity: 'ADVANCED_IMAGING', id: img, field: 'pv_anatomy_variant_present', value: 'YES' },
      ],
    });
    const r = res.data.results.filter((x: { kind: string }) => x.kind === 'change');
    expect(r[0]).toMatchObject({ ok: false, message: expect.stringMatching(/does not apply/) });
    expect(r[1]).toMatchObject({ ok: true });
  });
});
