// Values the app fills by itself (field review phase 2, shared/derive.ts): pure functions, then the server storing
// them after a save. Synthetic data only (MRNs 999xxxx).
import { beforeEach, describe, expect, it } from 'vitest';
import { as, dict, edit, harness, newCase, rid, type Harness } from './harness.ts';
import { egfr, bmi, hajjTiming, procedureType } from '../../shared/derive.ts';
import { expectedSlot } from '../../server/domain/cases.ts';

const season = dict.layout.form!.hajj_season!;
const HIJRI = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
/** The first 2026–2027 date with this Hijri month and day. */
function dateOf(month: number, day: number): string {
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 11, 31); t += 86_400_000) {
    const p = HIJRI.formatToParts(new Date(t + 43_200_000));
    if (Number(p.find((x) => x.type === 'month')?.value) === month && Number(p.find((x) => x.type === 'day')?.value) === day) return new Date(t).toISOString().slice(0, 10);
  }
  throw new Error('not found');
}

describe('derive (pure)', () => {
  it('procedure type from the ticks: ablation first, then device work, LAA, ILR, EPS', () => {
    expect(procedureType(['DIAGNOSTIC_EPS', 'AF'], {})).toBe('ABLATION');
    expect(procedureType(['DEVICE_IMPLANT', 'CRT_CSP'], {})).toBe('CIED_IMPLANT');
    expect(procedureType(['DEVICE_IMPLANT'], { device_action: 'GENERATOR_CHANGE' })).toBe('GENERATOR_CHANGE');
    expect(procedureType(['LEAD_MANAGEMENT'], { lead_management_type: 'EXTRACT' })).toBe('EXTRACTION');
    expect(procedureType(['LEAD_MANAGEMENT'], { lead_management_type: 'REVISION' })).toBe('LEAD_REVISION');
    expect(procedureType(['ILR'], {})).toBe('ILR');
    expect(procedureType(['DIAGNOSTIC_EPS'], {})).toBe('EPS');
    expect(procedureType([], {})).toBeNull();
  });

  it('Hajj timing: season 1 Dhu al-Qa\'dah → 15 Muharram, rites 8–13 Dhu al-Hijjah', () => {
    expect(hajjTiming(dateOf(11, 1), 'HAJJ', season)).toBe('PRE_HAJJ');
    expect(hajjTiming(dateOf(12, 7), 'HAJJ', season)).toBe('PRE_HAJJ');
    expect(hajjTiming(dateOf(12, 8), 'HAJJ', season)).toBe('DURING_HAJJ');
    expect(hajjTiming(dateOf(12, 13), 'HAJJ', season)).toBe('DURING_HAJJ');
    expect(hajjTiming(dateOf(12, 14), 'HAJJ', season)).toBe('POST_HAJJ');
    expect(hajjTiming(dateOf(1, 15), 'HAJJ', season)).toBe('POST_HAJJ');
    expect(hajjTiming(dateOf(1, 16), 'HAJJ', season)).toBe('OUTSIDE_PILGRIMAGE_SEASON');
    expect(hajjTiming(dateOf(1, 16), 'UMRAH', season)).toBe('UMRAH_RELATED');
    expect(hajjTiming(dateOf(12, 9), 'NON_PILGRIM', season)).toBeNull();
    expect(hajjTiming(null, 'HAJJ', season)).toBeNull();
  });

  it('eGFR (CKD-EPI 2021) and BMI', () => {
    expect(egfr(70.72, 60, 'FEMALE')).toBe(84);
    expect(egfr(88.4, 50, 'MALE')).toBe(92);
    expect(egfr(88.4, null, 'MALE')).toBeNull();
    expect(egfr(88.4, 50, null)).toBeNull();
    expect(bmi(172, 84)).toBe(28.4);
    expect(bmi(null, 84)).toBeNull();
  });
});

describe('derive (stored by the server after a save)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });

  it('fills procedure date and type, diagnosis, Hajj timing and eGFR; a person\'s diagnosis is kept', async () => {
    const sara = await as(h, 'sara');
    const id = (await newCase(sara, '9990961')).case_id;
    let d = (await sara.call('GET', `/api/cases/${id}`)).data;
    const ep = d.meta.episode_id;
    const pat = d.meta.patient_id;
    const p = rid('EP_PROCEDURES');
    const af = expectedSlot(dict, 'AF_ABLATIONS', p);
    await edit(sara, id, {
      creates: [{ entity: 'EP_PROCEDURES', id: p }, { entity: 'PROCEDURE_COMPONENTS', id: rid('PROCEDURE_COMPONENTS'), parent_id: p, values: { component_type: 'AF' } }, { entity: 'AF_ABLATIONS', id: af, parent_id: p }],
      changes: [
        { entity: 'AF_ABLATIONS', id: af, field: 'af_type_at_procedure', value: 'PERSISTENT_AF' },
        { entity: 'EP_EPISODES', id: ep, field: 'pilgrim_status', value: 'HAJJ' },
        { entity: 'PATIENTS', id: pat, field: 'sex_at_birth', value: 'MALE' },
        { entity: 'PATIENT_IDENTIFIERS', id: pat, field: 'date_of_birth', value: '1976-01-01' },
      ],
    });
    const lab = rid('LAB_RESULTS');
    await edit(sara, id, { creates: [{ entity: 'LAB_RESULTS', id: lab }], changes: [{ entity: 'LAB_RESULTS', id: lab, field: 'lab_date', value: '2026-03-10' }, { entity: 'LAB_RESULTS', id: lab, field: 'creatinine_umol_l', value: 88.4 }] });
    d = (await sara.call('GET', `/api/cases/${id}`)).data;
    const proc = d.rows.EP_PROCEDURES[0];
    expect(proc.primary_procedure_type).toBe('ABLATION');
    expect(proc.procedure_start_datetime).toBe(d.rows.EP_EPISODES[0].episode_start_date);
    expect(d.rows.ARRHYTHMIA_INDICATIONS[0]).toMatchObject({ primary_ep_diagnosis: 'AF', diagnosis_subtype: 'PERSISTENT_AF' });
    expect(d.rows.EP_EPISODES[0].hajj_timing).toBeTruthy();
    expect(d.rows.LAB_RESULTS[0]).toMatchObject({ egfr_ml_min_1_73m2: 92, episode_id: ep, });

    // A person's own diagnosis stays; Hajj timing goes when the patient is not a pilgrim.
    const ind = d.rows.ARRHYTHMIA_INDICATIONS[0]._id;
    await edit(sara, id, { changes: [{ entity: 'ARRHYTHMIA_INDICATIONS', id: ind, field: 'primary_ep_diagnosis', value: 'VT' }, { entity: 'EP_EPISODES', id: ep, field: 'pilgrim_status', value: 'NON_PILGRIM' }] });
    d = (await sara.call('GET', `/api/cases/${id}`)).data;
    expect(d.rows.ARRHYTHMIA_INDICATIONS[0].primary_ep_diagnosis).toBe('VT');
    expect(d.rows.EP_EPISODES[0].hajj_timing ?? null).toBeNull();
  });
});
