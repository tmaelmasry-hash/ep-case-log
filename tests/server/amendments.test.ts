// Owner-approved local amendments from EP Workspace (M-3, M-4a, M-4b), laid on top of the unchanged dictionary.
// Synthetic data only.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../server/dictionary.ts';
import { applyAmendments } from '../../shared/amendments.ts';
import { encodeValue } from '../../shared/validate.ts';

const { dict } = loadConfig();
const field = (e: string, f: string) => dict.entities[e].fields.find((x) => x.name === f)!;

describe('amendments', () => {
  it('adds the M-3 fields where EP Workspace put them, and the LAA closure section and codes', () => {
    const af = dict.entities.AF_ABLATIONS.fields.map((f) => f.name);
    expect(af.indexOf('af_energy_sources_used')).toBe(af.indexOf('af_energy_source') + 1);
    expect(dict.entities.DEVICE_IMPLANTS.fields.filter((f) => f.amendment?.startsWith('M3-D')).length).toBe(26); // ICD items D1–D26
    expect(dict.entities.LAA_CLOSURES).toMatchObject({ scope: 'procedure', cardinality: 'single', module: ['LAA_CLOSURE'] });
    expect(field('PROCEDURE_COMPONENTS', 'component_type').codes!.map((c) => c.code)).toContain('LAA_CLOSURE');
    expect(field('COMPLICATIONS', 'category').codes!.map((c) => c.code)).toEqual(expect.arrayContaining(['DEEP_VEIN_THROMBOSIS', 'SEPSIS', 'SET_SCREW_PROBLEM']));
  });

  it('M-4a: stroke, TIA and thromboembolism replace the combined item in the core list and are copied forward', () => {
    expect([...dict.core].filter((k) => k.startsWith('CLINICAL_PROFILE_SNAPSHOTS.prior_'))).toEqual(['CLINICAL_PROFILE_SNAPSHOTS.prior_stroke', 'CLINICAL_PROFILE_SNAPSHOTS.prior_tia', 'CLINICAL_PROFILE_SNAPSHOTS.prior_thromboembolic_event']);
    expect(dict.entities.CLINICAL_PROFILE_SNAPSHOTS.copy_forward).toEqual(expect.arrayContaining(['prior_stroke', 'prior_tia', 'prior_thromboembolic_event', 'cardiomyopathy_types']));
    expect(field('CLINICAL_PROFILE_SNAPSHOTS', 'prior_stroke_tia_systemic_embolism').label).toMatch(/old combined item/);
  });

  it('M-4b: cardiomyopathy types is multi-choice; None and Unknown stand alone', () => {
    const f = field('CLINICAL_PROFILE_SNAPSHOTS', 'cardiomyopathy_types');
    expect(f.type).toBe('lookup_array');
    expect(encodeValue(f, ['ISCHEMIC', 'HYPERTROPHIC'], {})).toBe('["HYPERTROPHIC","ISCHEMIC"]');
    expect(() => encodeValue(f, ['NONE', 'ISCHEMIC'], {})).toThrow(/cannot be combined/);
  });

  it('never changes or hides what the dictionary says', () => {
    const ents = { X: { pk: 'x_id', parentFk: [], fields: [{ name: 'a', label: 'A', type: 'enum', req: 'O', codes: [{ code: 'YES', label: 'Yes' }] }] } };
    const layout = { entities: { X: { cardinality: 'single', label: 'X' } } } as never;
    expect(() => applyAmendments(ents, layout, { fields: { X: [{ name: 'a', label: 'A', type: 'string', amendment: 'T1' }] } })).toThrow(/already exists/);
    expect(() => applyAmendments(ents, layout, { codes: { 'X.a': [{ code: 'YES', label: 'Yes', amendment: 'T2' }] } })).toThrow(/already a code/);
    expect(() => applyAmendments(ents, layout, { fields: { X: [{ name: 'b', label: 'B', type: 'string' }] } })).toThrow(/proposal item/);
  });
});
