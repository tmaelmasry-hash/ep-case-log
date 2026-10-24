// Local-first L3: a case made offline is created under the id the device chose; sending it again is harmless; the
// patient id of an earlier case of the MRN wins. Synthetic MRNs (9990xxx) only.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, harness, newCase, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

const uuid = () => crypto.randomUUID();

describe('offline new case', () => {
  it('uses the device id, answers a repeat with the same case, and numbers it once', async () => {
    const sara = await as(h, 'sara');
    const body = { case_id: `case_${uuid()}`, patient_id: `patient_${uuid()}`, group_id: h.groups[0].group_id, mrn: '9990301', episode_start_date: '2026-05-01', new_case: true };
    const a = await sara.call('POST', '/api/cases', body);
    expect(a.status).toBe(200);
    expect(a.data.case_id).toBe(body.case_id);
    expect(a.data.patient_id).toBe(body.patient_id);
    const again = await sara.call('POST', '/api/cases', body);
    expect(again.data).toMatchObject({ case_id: body.case_id, group_seq: a.data.group_seq });
    const list = (await sara.call('GET', '/api/cases')).data.cases.filter((c: { mrn: string }) => c.mrn === '9990301');
    expect(list).toHaveLength(1);
  });

  it('an earlier case of the MRN gives the patient id; bad ids are refused', async () => {
    const sara = await as(h, 'sara');
    const first = await newCase(sara, '9990302');
    const d = (await sara.call('GET', `/api/cases/${first.case_id}`)).data;
    const r = await sara.call('POST', '/api/cases', { case_id: `case_${uuid()}`, patient_id: `patient_${uuid()}`, group_id: h.groups[0].group_id, mrn: '9990302', episode_start_date: '2026-05-02', new_case: true });
    expect(r.data.patient_id).toBe(d.meta.patient_id);
    const bad = await sara.call('POST', '/api/cases', { case_id: 'case_../x', group_id: h.groups[0].group_id, mrn: '9990303', episode_start_date: '2026-05-02' });
    expect(bad.status).toBe(400);
  });
});
