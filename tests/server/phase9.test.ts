// Phase 9: Admin dashboard (counts only, per procedure) and My work. Synthetic MRNs (9990xxx) only.
import { beforeEach, describe, expect, it } from 'vitest';
import { expectedSlot } from '../../server/domain/cases.ts';
import { afGateOk, weekStart } from '../../server/domain/dashboard.ts';
import { as, dict, edit, harness, newCase, rid, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

describe('AF acute success gate (CANON_AF_ENDPOINT_V1, as in EP Workspace)', () => {
  const base = { 'AF_ABLATIONS.pvi_block_confirmation': 'ENTRANCE_AND_EXIT', 'AF_ABLATIONS.pvi_or_reisolation_attempted': 1, 'AF_ABLATIONS.pv_status_at_case_end': 'ALL_TARGET_PVS_ISOLATED' };
  it('first procedure: PVI attempted, all isolated and block confirmed', () => {
    expect(afGateOk({ ...base, 'EP_PROCEDURES.first_or_redo': 'FIRST' })).toBe(true);
    expect(afGateOk({ ...base, 'EP_PROCEDURES.first_or_redo': 'FIRST', 'AF_ABLATIONS.pvi_block_confirmation': 'NOT_TESTED' })).toBe(false);
  });
  it('redo: the durable branch counts too; unknown first/redo never counts', () => {
    expect(afGateOk({ 'EP_PROCEDURES.first_or_redo': 'REDO', 'AF_ABLATIONS.pvi_block_confirmation': 'ENTRANCE', 'AF_ABLATIONS.pvi_or_reisolation_attempted': 0, 'AF_ABLATIONS.pv_status_at_case_end': 'NO_RECONNECTION_CONFIRMED', 'AF_ABLATIONS.pv_reconnection_present_at_redo': 0 })).toBe(true);
    expect(afGateOk({ ...base })).toBe(false);
  });
});

describe('dashboard', () => {
  it('Admin only; counts procedures per type and acute success; no MRNs in the answer', async () => {
    const sara = await as(h, 'sara');
    const admin = await as(h, 'admin');
    expect((await sara.call('GET', '/api/dashboard')).status).toBe(403);
    const { case_id } = await newCase(sara, '9990501');
    await newCase(sara, '9990502'); // MRN only
    const p1 = rid('EP_PROCEDURES');
    const p2 = rid('EP_PROCEDURES');
    await edit(sara, case_id, {
      creates: [
        { entity: 'EP_PROCEDURES', id: p1 },
        { entity: 'PROCEDURE_COMPONENTS', id: rid('PROCEDURE_COMPONENTS'), parent_id: p1, values: { component_type: 'AVNRT' } },
        { entity: 'SVT_ABLATIONS', id: expectedSlot(dict, 'SVT_ABLATIONS', p1), parent_id: p1 },
        { entity: 'EP_PROCEDURES', id: p2 },
        { entity: 'PROCEDURE_COMPONENTS', id: rid('PROCEDURE_COMPONENTS'), parent_id: p2, values: { component_type: 'AVNRT' } },
        { entity: 'EXT_PROCEDURE_REVIEW', id: expectedSlot(dict, 'EXT_PROCEDURE_REVIEW', p1), parent_id: p1 },
      ],
      changes: [
        { entity: 'EP_PROCEDURES', id: p1, field: 'procedure_start_datetime', value: '2026-03-12T10:00' },
        { entity: 'SVT_ABLATIONS', id: expectedSlot(dict, 'SVT_ABLATIONS', p1), field: 'acute_svt_endpoint', value: 'NONINDUCIBLE' },
        { entity: 'EXT_PROCEDURE_REVIEW', id: expectedSlot(dict, 'EXT_PROCEDURE_REVIEW', p1), field: 'complications_reviewed', value: 'NONE_DOCUMENTED' },
      ],
    });
    const d = (await admin.call('GET', '/api/dashboard?basis=ALL')).data;
    expect(d.progress).toMatchObject({ total: 2, started: 1, mrn_only: 1, completed: 0 });
    // The MRN-only case was added by the Admin and nobody has filled it in yet.
    expect(d.progress.by_collector.find((x: { name: string }) => x.name === 'Sara')).toMatchObject({ total: 1 });
    const svt = d.clinical.by_type.find((t: { id: string }) => t.id === 'SVT_ABLATION');
    expect(svt).toMatchObject({ procedures: 2, by_month: { '2026-03': 2 }, no_date: 0 }); // a procedure without a date takes the episode date (field review phase 2)
    expect(d.clinical.acute_success.find((a: { id: string }) => a.id === 'SVT_ABLATION')).toMatchObject({ success: 1, not_recorded: 1, pct: 100 });
    expect(d.clinical.complications).toMatchObject({ reviewed: 1, present: 0, not_reviewed: 1 });
    expect(JSON.stringify(d)).not.toContain('9990501');
    // Default basis: Completed cases only.
    expect((await admin.call('GET', '/api/dashboard')).data.clinical.cases).toBe(0);
  });
});

describe('dashboard of a filtered list (R2-8)', () => {
  it('POST with case ids counts only those cases; Members cannot', async () => {
    const admin = await as(h, 'admin');
    const a = (await newCase(admin, '9990971')).case_id;
    await newCase(admin, '9990972');
    expect((await admin.call('GET', '/api/dashboard?basis=ALL')).data.progress.total).toBe(2);
    const r = await admin.call('POST', '/api/dashboard', { basis: 'ALL', case_ids: [a] });
    expect(r.data.progress.total).toBe(1);
    expect((await (await as(h, 'sara')).call('POST', '/api/dashboard', { case_ids: [a] })).status).toBe(403);
  });
});

describe('My work', () => {
  it('lists the user\'s own open cases with what is missing; others\' cases are not shown', async () => {
    const sara = await as(h, 'sara');
    const admin = await as(h, 'admin');
    await newCase(sara, '9990511'); // added by the Admin, not filled in yet: work for every Member of the group
    await newCase(admin, '9990512', h.groups[1].group_id);
    const w = (await sara.call('GET', '/api/mywork')).data;
    expect(w.totals).toMatchObject({ mine: 1, in_progress: 1 });
    expect(w.items[0]).toMatchObject({ mrn: '9990511', stage: 'MRN_ONLY' });
    expect(w.items[0].missing).toContain('Sex');
    expect(w.reminders.map((r: { kind: string }) => r.kind)).toContain('mrn_only');
  });

  it('step 5: fewest missing first, and "done this week" counts my Completed cases since Sunday (Riyadh)', async () => {
    const sara = await as(h, 'sara');
    const a = (await newCase(sara, '9990513')).case_id;
    const b = (await newCase(sara, '9990514')).case_id;
    const d = (await sara.call('GET', `/api/cases/${b}`)).data;
    await edit(sara, b, { changes: [{ entity: 'PATIENTS', id: d.meta.patient_id, field: 'sex_at_birth', value: 'FEMALE' }] });
    const w = (await sara.call('GET', '/api/mywork')).data;
    expect(w.items.map((x: { mrn: string }) => x.mrn)).toEqual(['9990514', '9990513']);
    expect(w.items[0].missing_count).toBe(w.items[1].missing_count - 1);
    expect(w.totals.done_this_week).toBe(0);

    // Marked Completed by Sara this week (the harness clock is Thu 22 Oct 2026) and last week.
    const me = (await sara.call('GET', '/api/auth/me')).data.user.id;
    const mark = async (id: string, at: string) => {
      const rec = (await h.store.getCase(id, { forEdit: true }))!;
      await h.store.putCase({ ...rec, meta: { ...rec.meta, collection_status: 'COMPLETED', completed_by: me, completed_at: at } }, rec);
    };
    await mark(a, '2026-10-17T22:00:00Z'); // Sun 18 Oct 01:00 in Riyadh: this week
    await mark(b, '2026-10-17T20:00:00Z'); // Sat 17 Oct 23:00 in Riyadh: last week
    expect((await sara.call('GET', '/api/mywork')).data.totals.done_this_week).toBe(1);
  });

  it('the week starts on Sunday in the site time zone', () => {
    expect(weekStart(new Date('2026-10-22T08:00:00Z'), 'Asia/Riyadh')).toBe('2026-10-18');
    expect(weekStart(new Date('2026-10-24T22:00:00Z'), 'Asia/Riyadh')).toBe('2026-10-25'); // Sunday 01:00 local
    expect(weekStart(new Date('2026-10-24T20:00:00Z'), 'Asia/Riyadh')).toBe('2026-10-18'); // Saturday 23:00 local
  });
});
