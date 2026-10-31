// R4-3 / Q-F12 (owner 31 Oct): the 15 NCDR lead locations (NCDR ICD v3.0 #7735) in the same Lead location question.
// 8 codes added; 7 existing codes shown by their NCDR name (stored codes unchanged); the coarse old Epicardial and
// Subcutaneous are kept for old rows but no longer offered. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../server/dictionary.ts';
import { applyEdits, newCaseRecord } from '../../server/domain/cases.ts';
import { idPrefix } from '../../shared/caseTypes.ts';
import { codeLabel, offeredCodes } from '../../shared/dictionary.ts';

const { dict } = loadConfig();
const f = dict.entities.DEVICE_LEADS.fields.find((x) => x.name === 'lead_location')!;
const NCDR = ['RA endocardial', 'RA epicardial', 'RV endocardial', 'RV epicardial', 'His bundle', 'Left bundle', 'LV endocardial', 'LV epicardial (CVS)', 'LV epicardial (surgical)', 'Azygos vein', 'SVC / subclavian', 'Subcutaneous array', 'Subcutaneous (S-ICD)', 'Substernal', 'Other'];

describe('NCDR lead locations', () => {
  it('offers the 15 NCDR locations in NCDR order; old codes keep their stored value and get the NCDR name', () => {
    expect(offeredCodes(f, {}).map((c) => codeLabel(f, c))).toEqual(NCDR);
    expect(['RA', 'RV', 'HIS', 'LBB_AREA', 'CS_LV'].map((c) => codeLabel(f, c))).toEqual(['RA endocardial', 'RV endocardial', 'His bundle', 'Left bundle', 'LV epicardial (CVS)']);
  });

  it('the coarse old Epicardial / Subcutaneous are not offered, but a row that holds one keeps showing it', () => {
    expect(offeredCodes(f, {})).not.toContain('EPICARDIAL');
    expect(offeredCodes(f, { lead_location: 'EPICARDIAL' })).toContain('EPICARDIAL');
    expect(codeLabel(f, 'SUBCUTANEOUS')).toBe('Subcutaneous (old, not split)');
  });

  it('a new code saves', () => {
    const a = { userId: 'u1', now: '2026-10-31T09:00:00Z' };
    const rec = newCaseRecord(dict, { caseId: `case_${crypto.randomUUID()}`, patientId: `patient_${crypto.randomUUID()}`, mrn: '9990471', groupId: 'grp_1', groupSeq: 1, episodeStart: '2026-10-01', enrollmentDate: '2026-10-31', registryBasis: 'CLINICAL_QI' }, a);
    const id = `${idPrefix(dict.entities.DEVICE_LEADS.pk)}_${crypto.randomUUID()}`;
    const r = applyEdits(dict, rec, { creates: [{ entity: 'DEVICE_LEADS', id, values: { lead_type: 'PACE_SENSE', lead_location: 'LV_ENDOCARDIAL' } }] }, a, new Set(['u1']));
    expect(r[0].ok, JSON.stringify(r)).toBe(true);
    expect(rec.rows.DEVICE_LEADS[0].lead_location).toBe('LV_ENDOCARDIAL');
  });
});
