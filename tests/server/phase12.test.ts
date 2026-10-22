// Phase 12: follow-up bell (built switched off, as in EP Workspace F-19). Synthetic MRNs (9990xxx) only.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkFollowupConfig, followUpsDue } from '../../server/domain/followups.ts';
import type { CaseRecord } from '../../shared/caseTypes.ts';
import { as, config, dict, edit, harness, newCase, rid, type Harness } from './harness.ts';

let h: Harness;
const rule = config.site.followup_due!;
beforeEach(async () => {
  h = await harness(); // today = 2026-10-22
});
afterEach(() => {
  rule.enabled = false;
});

async function caseWithProcedure(c: Awaited<ReturnType<typeof as>>, mrn: string, start: string, group?: string, values: Record<string, unknown> = {}) {
  const { case_id } = await newCase(c, mrn, group);
  const proc = rid('EP_PROCEDURES');
  await edit(c, case_id, { creates: [{ entity: 'EP_PROCEDURES', id: proc, values: { procedure_start_datetime: start, ...values } }] });
  return { case_id, proc };
}

describe('follow-up bell', () => {
  it('is off by default: no list, and the app is told not to show the bell', async () => {
    const sara = await as(h, 'sara');
    await caseWithProcedure(sara, '9990501', '2026-09-25T09:20');
    expect(rule.enabled).toBe(false);
    const r = await sara.call('GET', '/api/followups');
    expect(r.data).toEqual({ enabled: false, today: '2026-10-22', items: [] });
    expect((await sara.call('GET', '/api/auth/me')).data.features).toEqual({ followup_bell: false });
  });

  it('when on: lists timepoints due per procedure until a visit with that timepoint exists; own groups only', async () => {
    const sara = await as(h, 'sara');
    const omar = await as(h, 'omar');
    const a = await caseWithProcedure(sara, '9990502', '2026-09-25T09:20'); // D30 due 2026-10-25
    const b = await caseWithProcedure(sara, '9990503', '2026-04-25T10:00'); // M6 due 2026-10-24
    await caseWithProcedure(sara, '9990504', '2026-09-25T09:20', undefined, { procedure_status: 'CANCELLED_BEFORE_START' });
    const dead = await caseWithProcedure(sara, '9990505', '2026-09-25T09:20');
    await edit(sara, dead.case_id, { creates: [{ entity: 'FOLLOW_UPS', id: rid('FOLLOW_UPS'), parent_id: dead.proc, values: { vital_status: 'DECEASED' } }] });
    await caseWithProcedure(omar, '9990506', '2026-09-25T09:20', h.groups[1].group_id);
    rule.enabled = true;

    const r = await sara.call('GET', '/api/followups');
    expect(r.data.enabled).toBe(true);
    expect(r.data.items.map((i: { mrn: string; what: string; days: number }) => [i.mrn, i.what, i.days])).toEqual([
      ['9990503', 'M6 visit', 2],
      ['9990502', 'D30 visit', 3],
    ]);
    expect(r.data.items[1]).toMatchObject({ case_id: a.case_id, procedure_id: a.proc, kind: 'visit', due_date: '2026-10-25' });
    expect((await sara.call('GET', '/api/auth/me')).data.features).toEqual({ followup_bell: true });

    // The M6 visit is recorded for that procedure → it leaves the list.
    await edit(sara, b.case_id, { creates: [{ entity: 'FOLLOW_UPS', id: rid('FOLLOW_UPS'), parent_id: b.proc, values: { followup_timepoint: 'M6' } }] });
    const after = await sara.call('GET', '/api/followups');
    expect(after.data.items.map((i: { mrn: string }) => i.mrn)).toEqual(['9990502']);
    // Omar sees only his group.
    expect((await omar.call('GET', '/api/followups')).data.items.map((i: { mrn: string }) => i.mrn)).toEqual(['9990506']);
  });

  it('device check: the latest check\'s next due date; the rule is checked against the dictionary', () => {
    const rec = {
      meta: { case_id: 'c1', mrn: '9990507', group_id: 'g', group_seq: 1, is_deleted: false },
      rows: {
        DEVICE_INTERROGATIONS: [
          { _id: 'd1', check_datetime: '2026-01-10T10:00', next_check_due_date: '2026-07-10' },
          { _id: 'd2', check_datetime: '2026-07-12T10:00', next_check_due_date: '2026-11-12' },
        ],
      },
    } as unknown as CaseRecord;
    expect(followUpsDue({ ...rule, enabled: true }, [rec], '2026-10-22')).toMatchObject([{ kind: 'device_check', due_date: '2026-11-12', days: 21 }]);
    expect(followUpsDue({ ...rule, enabled: false }, [rec], '2026-10-22')).toEqual([]);
    expect(() => checkFollowupConfig(dict, { ...rule, timepoints: [{ code: 'M7', days: 210 }] })).toThrow(/M7 is not a code/);
    expect(() => checkFollowupConfig(dict, { ...rule, procedure_date_field: 'EP_PROCEDURES.made_up' })).toThrow(/not a dictionary field/);
  });
});
