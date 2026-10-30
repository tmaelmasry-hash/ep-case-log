// Owner decision (30 Oct 2026): the "What was done?" ticks of a procedure (Pacemaker / ICD / CRT / CSP / Generator
// change / Other device) are saved with the case, so every device and user sees them. Operational Cases column
// picked_items_json; known item ids only. Synthetic MRNs (9990xxx) only.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, edit, harness, newCase, rid, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

async function caseWithProcedure(mrn: string) {
  const sara = await as(h, 'sara');
  const { case_id } = await newCase(sara, mrn);
  const pid = rid('EP_PROCEDURES');
  await edit(sara, case_id, { creates: [{ entity: 'EP_PROCEDURES', id: pid }], picked_items: [{ procedure_id: pid, items: ['ICD', 'PACEMAKER'] }] });
  return { sara, case_id, pid };
}

describe('"What was done?" ticks saved with the case', () => {
  it('a Member saves them; another user and a fresh read of the store see them (item order fixed)', async () => {
    const { case_id, pid } = await caseWithProcedure('9990701');
    const admin = await as(h, 'admin');
    expect((await admin.call('GET', `/api/cases/${case_id}`)).data.picked_items).toEqual({ [pid]: ['PACEMAKER', 'ICD'] });
    expect((await h.store.getCase(case_id))!.picked_items).toEqual({ [pid]: ['PACEMAKER', 'ICD'] });
  });

  it('the last save wins; an empty list clears it; removing the procedure drops it', async () => {
    const { sara, case_id, pid } = await caseWithProcedure('9990702');
    const admin = await as(h, 'admin');
    await edit(admin, case_id, { picked_items: [{ procedure_id: pid, items: ['OTHER_DEVICE'] }] });
    expect((await sara.call('GET', `/api/cases/${case_id}`)).data.picked_items).toEqual({ [pid]: ['OTHER_DEVICE'] });
    await edit(sara, case_id, { picked_items: [{ procedure_id: pid, items: [] }] });
    expect((await h.store.getCase(case_id))!.picked_items ?? {}).toEqual({});
    await edit(sara, case_id, { picked_items: [{ procedure_id: pid, items: ['CRT'] }] });
    await edit(sara, case_id, { removes: [{ entity: 'EP_PROCEDURES', id: pid }] });
    expect((await h.store.getCase(case_id))!.picked_items ?? {}).toEqual({});
  });

  it('refuses unknown items and procedures; other groups cannot write', async () => {
    const { sara, case_id, pid } = await caseWithProcedure('9990703');
    const bad = await sara.call('PATCH', `/api/cases/${case_id}`, {
      picked_items: [
        { procedure_id: pid, items: ['ICD', 'NOT_AN_ITEM'] },
        { procedure_id: rid('EP_PROCEDURES'), items: ['ICD'] },
        { procedure_id: pid, items: 'ICD' },
      ],
    });
    expect(bad.status).toBe(200);
    expect(bad.data.results.map((r: { ok: boolean }) => r.ok)).toEqual([false, false, false]);
    expect(bad.data.results[0].message).toBe('What was done: unknown item.');
    expect(bad.data.case.picked_items).toEqual({ [pid]: ['PACEMAKER', 'ICD'] });
    const omar = await as(h, 'omar');
    const out = await omar.call('PATCH', `/api/cases/${case_id}`, { picked_items: [{ procedure_id: pid, items: ['GEN'] }] });
    expect([403, 404]).toContain(out.status);
    expect((await h.store.getCase(case_id))!.picked_items).toEqual({ [pid]: ['PACEMAKER', 'ICD'] });
  });
});
