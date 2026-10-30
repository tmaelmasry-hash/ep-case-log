// Patient timeline (R4-9): each record is dated by its own dictionary field only; undated and partial dates as written.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTimeline, byYear, fmtTimelineDate, recordedDate, TIMELINE_SOURCES, type Namer, type TimelineCase } from '../../shared/timeline.ts';

const name: Namer = { code: (_e, _f, c) => `<${c}>`, procedure: (_c, id) => `Proc ${id}` };
const kase = (seq: number, rows: TimelineCase['rows']): TimelineCase => ({ case_id: `case${seq}`, group_seq: seq, rows });
const audit = { _created_at: '2026-01-01T08:00:00Z', _updated_at: '2026-01-02T08:00:00Z', created_at: '2026-01-01' };

describe('timeline date map', () => {
  it('names only real dictionary date fields', () => {
    for (const s of TIMELINE_SOURCES) {
      const e = JSON.parse(readFileSync(`config/dictionary/entities/${s.entity}.json`, 'utf8')) as { fields: { name: string; type: string; codes?: unknown[] }[] };
      for (const f of [s.field, s.scheduledField].filter(Boolean)) expect(['date', 'datetime']).toContain(e.fields.find((x) => x.name === f)?.type);
      for (const f of [s.titleField, s.detailField].filter(Boolean)) expect(e.fields.find((x) => x.name === f)?.codes, `${s.entity}.${f}`).toBeTruthy();
    }
  });

  it('dates each kind by its own field, newest first, in year groups', () => {
    const { events, undated } = buildTimeline(
      [
        kase(12, {
          EP_EPISODES: [{ _id: 'ep1', episode_start_date: '2025-12-30', ...audit }],
          EP_PROCEDURES: [{ _id: 'p1', procedure_start_datetime: '2026-03-15T09:30', ...audit }],
          ECG_STUDIES: [{ _id: 'e1', ecg_datetime: '2026-03-02T10:00', ecg_context: 'ARRHYTHMIA' }],
          LAB_RESULTS: [{ _id: 'l1', lab_date: '2026-03-10' }],
          FOLLOW_UPS: [{ _id: 'f1', actual_followup_date: '2026-04-20', followup_timepoint: 'D30' }],
          OUTCOME_EVENTS: [{ _id: 'o1', event_date: '2026-09-15', event_type: 'ARRHYTHMIA_RECURRENCE' }],
        }),
      ],
      name,
    );
    expect(undated).toEqual([]);
    expect(events.map((e) => `${e.date} ${e.title}`)).toEqual([
      '2026-09-15 <ARRHYTHMIA_RECURRENCE>',
      '2026-04-20 Follow-up visit · <D30>',
      '2026-03-15T09:30 Proc p1',
      '2026-03-10 Labs',
      '2026-03-02T10:00 ECG',
      '2025-12-30 Episode start',
    ]);
    expect(events.find((e) => e.kind === 'ecg')?.detail).toBe('<ARRHYTHMIA>');
    expect(byYear(events).map((g) => [g.year, g.events.length])).toEqual([
      ['2026', 5],
      ['2025', 1],
    ]);
  });

  it('never falls back to created/updated times: records without their date go to "Without a date"', () => {
    const { events, undated } = buildTimeline(
      [
        kase(12, { ECHO_STUDIES: [{ _id: 'x1', echo_date: null, ...audit }] }),
        kase(15, { RHYTHM_MONITORING: [{ _id: 'h1', monitor_type: 'HOLTER', end_datetime: '2026-05-02T08:00', ...audit }], EP_EPISODES: [{ _id: 'ep', ...audit }] }),
      ],
      name,
    );
    expect(events).toEqual([]);
    expect(undated.map((u) => `${u.title} · case No. ${u.group_seq}`)).toEqual(['Episode start · case No. 15', '<HOLTER> · case No. 15', 'Echocardiography · case No. 12']);
  });

  it('a procedure without a start but with a scheduled date is a scheduled procedure', () => {
    const { events } = buildTimeline([kase(3, { EP_PROCEDURES: [{ _id: 'p9', scheduled_date: '2026-11-02' }] })], name);
    expect(events[0]).toMatchObject({ date: '2026-11-02', title: 'Scheduled procedure · Proc p9', scheduled: true, procedure_id: 'p9' });
  });

  it('planned follow-ups (no actual date) are not shown at all', () => {
    const { events, undated } = buildTimeline([kase(3, { FOLLOW_UPS: [{ _id: 'f', followup_timepoint: 'M6', followup_completion_status: 'OPEN' }] })], name);
    expect(events).toEqual([]);
    expect(undated).toEqual([]);
  });

  it('deleted rows are left out', () => {
    const { events } = buildTimeline([kase(3, { LAB_RESULTS: [{ _id: 'l', lab_date: '2026-01-01', _deleted: true }] })], name);
    expect(events).toEqual([]);
  });

  it('keeps a partial date as written and never turns it into a day', () => {
    expect(recordedDate('2026')).toBe('2026');
    expect(recordedDate('2026-03')).toBe('2026-03');
    expect(recordedDate(2019)).toBe('2019');
    expect(recordedDate('')).toBeNull();
    expect(recordedDate('soon')).toBeNull();
    expect(fmtTimelineDate('2026')).toBe('2026');
    expect(fmtTimelineDate('2026-03')).toBe('Mar 2026');
    expect(fmtTimelineDate('2026-03-02T10:00')).toBe('2 Mar');
    const { events } = buildTimeline(
      [
        kase(1, {
          LAB_RESULTS: [
            { _id: 'a', lab_date: '2026-03' },
            { _id: 'b', lab_date: '2026-03-20' },
            { _id: 'c', lab_date: '2026' },
          ],
        }),
      ],
      name,
    );
    expect(events.map((e) => e.date)).toEqual(['2026-03-20', '2026-03', '2026']);
  });
});
