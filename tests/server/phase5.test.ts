// Phase 5: MRN prompt and copy-forward of history (EP Workspace). Synthetic MRNs (9990xxx) only.
import { beforeEach, describe, expect, it } from 'vitest';
import { expectedSlot } from '../../server/domain/cases.ts';
import { as, dict, edit, harness, newCase, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

describe('MRN prompt', () => {
  it('an MRN with cases is answered with them first; new_case adds one more', async () => {
    const sara = await as(h, 'sara');
    const first = await newCase(sara, '9990201');
    expect(first.case_of_mrn).toBeNull();
    const r = await sara.call('POST', '/api/cases', { group_id: h.groups[0].group_id, mrn: '9990201', episode_start_date: '2026-05-01' });
    expect(r.status).toBe(409);
    expect(r.data.error.code).toBe('MRN_HAS_CASES');
    expect(r.data.error.details.here).toEqual([expect.objectContaining({ case_id: first.case_id, group_seq: 1 })]);
    expect(r.data.error.details.elsewhere).toBe(false);
    const second = await newCase(sara, '9990201', h.groups[0].group_id, { new_case: true });
    expect(second.group_seq).toBe(2);
    expect(second.case_of_mrn).toBe(2);
  });

  it('cases in groups the user cannot see are only mentioned, never shown', async () => {
    const omar = await as(h, 'omar');
    await newCase(omar, '9990202', h.groups[1].group_id);
    const sara = await as(h, 'sara');
    const r = await sara.call('POST', '/api/cases', { group_id: h.groups[0].group_id, mrn: '9990202', episode_start_date: '2026-05-01' });
    expect(r.status).toBe(409);
    expect(r.data.error.details).toEqual({ here: [], elsewhere: true });
    // Adding it copies nothing from a group Sara cannot see.
    const c = await newCase(sara, '9990202', h.groups[0].group_id, { new_case: true });
    expect(c.copied).toBe(0);
  });
});

describe('copy-forward', () => {
  it('copies only the history fields, marks them Copied until edited; procedures are never copied', async () => {
    const sara = await as(h, 'sara');
    const a = await newCase(sara, '9990203');
    const d = (await sara.call('GET', `/api/cases/${a.case_id}`)).data;
    const risk = expectedSlot(dict, 'CLINICAL_PROFILE_SNAPSHOTS', a.case_id);
    await edit(sara, a.case_id, {
      creates: [{ entity: 'CLINICAL_PROFILE_SNAPSHOTS', id: risk }, { entity: 'EP_PROCEDURES', id: `procedure_${crypto.randomUUID()}` }],
      changes: [
        { entity: 'PATIENTS', id: d.meta.patient_id, field: 'sex_at_birth', value: 'FEMALE' },
        { entity: 'PATIENT_IDENTIFIERS', id: d.meta.patient_id, field: 'date_of_birth', value: '1960-02-03' },
        { entity: 'CLINICAL_PROFILE_SNAPSHOTS', id: risk, field: 'hypertension', value: 'YES' },
        { entity: 'EP_EPISODES', id: d.meta.episode_id, field: 'pilgrim_status', value: 'HAJJ' },
      ],
    });
    const b = await newCase(sara, '9990203', h.groups[0].group_id, { new_case: true });
    expect(b.copied).toBe(3);
    expect(b.copied_from).toBe(`Copied from ${h.groups[0].name} No. 1`);
    const nd = (await sara.call('GET', `/api/cases/${b.case_id}`)).data;
    expect(nd.rows.PATIENTS[0].sex_at_birth).toBe('FEMALE');
    expect(nd.rows.PATIENT_IDENTIFIERS[0].date_of_birth).toBe('1960-02-03');
    expect(nd.rows.CLINICAL_PROFILE_SNAPSHOTS[0].hypertension).toBe('YES');
    expect(nd.rows.EP_EPISODES[0].pilgrim_status).toBeNull(); // the episode is new
    expect(nd.rows.EP_PROCEDURES ?? []).toEqual([]);
    expect(Object.keys(nd.copied).sort()).toEqual(['CLINICAL_PROFILE_SNAPSHOTS.hypertension', 'PATIENTS.sex_at_birth', 'PATIENT_IDENTIFIERS.date_of_birth']);
    // Editing a copied field removes its mark; the source case is unchanged.
    const after = await edit(sara, b.case_id, { changes: [{ entity: 'CLINICAL_PROFILE_SNAPSHOTS', id: expectedSlot(dict, 'CLINICAL_PROFILE_SNAPSHOTS', b.case_id), field: 'hypertension', value: 'NO' }] });
    expect(Object.keys(after.case.copied)).not.toContain('CLINICAL_PROFILE_SNAPSHOTS.hypertension');
    expect((await sara.call('GET', `/api/cases/${a.case_id}`)).data.rows.CLINICAL_PROFILE_SNAPSHOTS[0].hypertension).toBe('YES');
    const hist = (await sara.call('GET', `/api/cases/${b.case_id}/history`)).data.items.map((x: { text: string }) => x.text);
    expect(hist).toContain(`3 history values copied from ${h.groups[0].name} No. 1 (same MRN)`);
  });
});
