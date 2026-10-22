// Phase 7: light follow-up (EP Workspace O7). Synthetic MRNs (9990xxx) only.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, edit, harness, newCase, rid, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

describe('light follow-up', () => {
  it('a follow-up belongs to a procedure (index event = that procedure); quick events link to it', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '9990401');
    const proc = rid('EP_PROCEDURES');
    const fu = rid('FOLLOW_UPS');
    const ev = rid('OUTCOME_EVENTS');
    // A follow-up needs a procedure.
    const bad = await sara.call('PATCH', `/api/cases/${case_id}`, { creates: [{ entity: 'FOLLOW_UPS', id: fu }] });
    expect(bad.data.results[0]).toMatchObject({ ok: false, message: expect.stringMatching(/choose the procedure/) });
    const r = await edit(sara, case_id, {
      creates: [
        { entity: 'EP_PROCEDURES', id: proc },
        { entity: 'FOLLOW_UPS', id: fu, parent_id: proc, values: { followup_timepoint: 'M6' } },
        { entity: 'OUTCOME_EVENTS', id: ev, parent_id: proc, values: { followup_id: fu, event_type: 'ARRHYTHMIA_RECURRENCE' } },
      ],
      changes: [
        { entity: 'FOLLOW_UPS', id: fu, field: 'actual_followup_date', value: '2026-09-10' },
        { entity: 'OUTCOME_EVENTS', id: ev, field: 'event_date', value: '2026-08-01' },
      ],
    });
    expect(r.case.rows.FOLLOW_UPS[0]).toMatchObject({ index_event_type: 'PROCEDURE', index_event_id: proc, followup_timepoint: 'M6', actual_followup_date: '2026-09-10' });
    expect(r.case.rows.OUTCOME_EVENTS[0]).toMatchObject({ index_event_id: proc, followup_id: fu, event_type: 'ARRHYTHMIA_RECURRENCE', event_date: '2026-08-01' });
    // The polymorphic index fields are filled by the app, never typed.
    const typed = await sara.call('PATCH', `/api/cases/${case_id}`, { changes: [{ entity: 'FOLLOW_UPS', id: fu, field: 'index_event_id', value: 'x' }] });
    expect(typed.data.results[0].ok).toBe(false);
    // Removing the follow-up keeps the event and clears its link.
    const after = await edit(sara, case_id, { removes: [{ entity: 'FOLLOW_UPS', id: fu }] });
    expect(after.case.rows.FOLLOW_UPS ?? []).toEqual([]);
    expect(after.case.rows.OUTCOME_EVENTS[0]).toMatchObject({ event_type: 'ARRHYTHMIA_RECURRENCE', followup_id: null });
  });
});
