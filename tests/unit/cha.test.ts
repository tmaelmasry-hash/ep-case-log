// CHA₂DS₂-VASc display (phase 8): computed from dictionary fields, incomplete until every item is known.
import { describe, expect, it } from 'vitest';
import { cha2ds2vasc, chaRelevant } from '../../shared/cha.ts';

const rows = (risk: Record<string, string>, dob: string | null, sex: string | null) => ({
  CLINICAL_PROFILE_SNAPSHOTS: [risk],
  PATIENT_IDENTIFIERS: [{ date_of_birth: dob }],
  PATIENTS: [{ sex_at_birth: sex }],
  EP_EPISODES: [{ episode_start_date: '2026-03-12' }],
});
const all = (v: string) => ({ heart_failure: v, hypertension: v, diabetes: v, prior_stroke_tia_systemic_embolism: v, vascular_disease: v });

describe('CHA2DS2-VASc', () => {
  it('all items yes, age 75+, female = 9', () => {
    expect(cha2ds2vasc(rows(all('YES'), '1950-01-01', 'FEMALE')).score).toBe(9);
  });
  it('all no, age 64 (birthday after the episode), male = 0', () => {
    expect(cha2ds2vasc(rows(all('NO'), '1961-03-13', 'MALE')).score).toBe(0);
  });
  it('age 65 on the episode date scores 1; stroke scores 2', () => {
    expect(cha2ds2vasc(rows({ ...all('NO'), prior_stroke_tia_systemic_embolism: 'YES' }, '1961-03-12', 'MALE')).score).toBe(3);
  });
  it('incomplete while any item is unknown, unanswered, or age/sex missing', () => {
    expect(cha2ds2vasc(rows({ ...all('NO'), diabetes: 'UNKNOWN' }, '1950-01-01', 'MALE'))).toMatchObject({ score: null, missing: ['Diabetes'] });
    expect(cha2ds2vasc(rows(all('NO'), null, null)).missing).toEqual(['Age', 'Sex at birth']);
    expect(cha2ds2vasc({}).score).toBeNull();
  });
  it('shown for AF / flutter / AV-junction components or an AF / flutter diagnosis only', () => {
    expect(chaRelevant({ PROCEDURE_COMPONENTS: [{ component_type: 'AVNRT' }] })).toBe(false);
    expect(chaRelevant({ PROCEDURE_COMPONENTS: [{ component_type: 'FLUTTER' }] })).toBe(true);
    expect(chaRelevant({ ARRHYTHMIA_INDICATIONS: [{ primary_ep_diagnosis: 'AF' }] })).toBe(true);
  });
});
