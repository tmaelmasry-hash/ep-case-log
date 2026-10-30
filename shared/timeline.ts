// Patient timeline (owner R4-9): the recorded events of one MRN's cases, each by its own dictionary date field. The map
// below is the only place that says which field dates which kind of record; it is reviewed and never falls back to
// created/updated times or another field. A year-only or partial date is shown as written, never turned into a day.
// Planned follow-ups are not events (they stay on the Follow-up tab): a visit counts only with its actual date.

export type TimelineKind = 'episode' | 'procedure' | 'ecg' | 'lab' | 'echo' | 'monitor' | 'imaging' | 'device_check' | 'followup' | 'outcome';

export interface TimelineSource {
  kind: TimelineKind;
  entity: string;
  /** The dictionary date (or datetime) field that dates this record. */
  field: string;
  /** Used only when `field` is empty (EP_PROCEDURES: a scheduled date → "Scheduled procedure"). */
  scheduledField?: string;
  /** Records without `field` are left out entirely instead of listed under "Without a date" (planned follow-ups). */
  skipUndated?: boolean;
  /** Fallback title; `titleField` (a code of the same row) gives a more exact one. */
  title: string;
  titleField?: string;
  /** A code of the same row shown as the short detail. */
  detailField?: string;
}

export const TIMELINE_SOURCES: TimelineSource[] = [
  { kind: 'episode', entity: 'EP_EPISODES', field: 'episode_start_date', title: 'Episode start' },
  { kind: 'procedure', entity: 'EP_PROCEDURES', field: 'procedure_start_datetime', scheduledField: 'scheduled_date', title: 'Procedure' },
  { kind: 'ecg', entity: 'ECG_STUDIES', field: 'ecg_datetime', title: 'ECG', detailField: 'ecg_context' },
  { kind: 'lab', entity: 'LAB_RESULTS', field: 'lab_date', title: 'Labs', detailField: 'lab_context' },
  { kind: 'echo', entity: 'ECHO_STUDIES', field: 'echo_date', title: 'Echocardiography', detailField: 'echo_context' },
  { kind: 'monitor', entity: 'RHYTHM_MONITORING', field: 'start_datetime', title: 'Holter / rhythm monitoring', titleField: 'monitor_type', detailField: 'monitor_conclusion' },
  { kind: 'imaging', entity: 'ADVANCED_IMAGING', field: 'study_date', title: 'CMR / CT / TEE', titleField: 'modality_code' },
  { kind: 'device_check', entity: 'DEVICE_INTERROGATIONS', field: 'check_datetime', title: 'Device interrogation', detailField: 'check_type' },
  { kind: 'followup', entity: 'FOLLOW_UPS', field: 'actual_followup_date', skipUndated: true, title: 'Follow-up visit', titleField: 'followup_timepoint', detailField: 'contact_method' },
  { kind: 'outcome', entity: 'OUTCOME_EVENTS', field: 'event_date', title: 'Outcome event', titleField: 'event_type' },
];

/** What the timeline needs of one case: its rows (decoded, as the case screen gets them) and how to name things. */
export interface TimelineCase {
  case_id: string;
  group_seq: number;
  rows: Record<string, Record<string, unknown>[]>;
}

export interface TimelineEvent {
  kind: TimelineKind;
  case_id: string;
  group_seq: number;
  entity: string;
  row_id: string;
  /** The date exactly as recorded: YYYY, YYYY-MM, YYYY-MM-DD or a datetime. */
  date: string;
  /** First four digits (the year group). */
  year: string;
  title: string;
  detail: string | null;
  /** Only for kind procedure: the EP_PROCEDURES row id (for its name and color). */
  procedure_id?: string;
  scheduled?: boolean;
}

export interface TimelineUndated {
  kind: TimelineKind;
  case_id: string;
  group_seq: number;
  title: string;
}

export interface Namer {
  /** Label of a code of ENTITY.field. */
  code: (entity: string, field: string, code: string) => string;
  /** Name of a procedure (from its components / type). */
  procedure: (caseId: string, procedureId: string) => string;
}

const DATE_RE = /^\d{4}(-\d{2}(-\d{2}([T ].*)?)?)?$/;

/** A recorded date as written, or null when there is none (empty, or not a date at all). */
export function recordedDate(v: unknown): string | null {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1000 && v <= 9999) return String(v);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return DATE_RE.test(s) ? s : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026" → "2026", "2026-03" → "Mar 2026", "2026-03-02[T…]" → "2 Mar" (the year is the group heading). */
export function fmtTimelineDate(d: string): string {
  const [y, m, day] = d.slice(0, 10).split('-');
  if (!m) return y;
  const mon = MONTHS[Number(m) - 1] ?? m;
  if (!day) return `${mon} ${y}`;
  return `${Number(day)} ${mon}`;
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

export function buildTimeline(cases: TimelineCase[], name: Namer): { events: TimelineEvent[]; undated: TimelineUndated[] } {
  const events: TimelineEvent[] = [];
  const undated: TimelineUndated[] = [];
  for (const c of cases) {
    for (const src of TIMELINE_SOURCES) {
      for (const row of c.rows[src.entity] ?? []) {
        if (row._deleted) continue;
        const id = String(row._id ?? '');
        const own = str(row[src.titleField ?? '']);
        let title = own ? name.code(src.entity, src.titleField!, own) : src.title;
        if (src.kind === 'followup') title = own ? `Follow-up visit · ${title}` : title;
        if (src.kind === 'procedure') title = name.procedure(c.case_id, id);
        const detailCode = str(row[src.detailField ?? '']);
        const detail = detailCode ? name.code(src.entity, src.detailField!, detailCode) : null;
        let date = recordedDate(row[src.field]);
        let scheduled = false;
        if (!date && src.scheduledField) {
          date = recordedDate(row[src.scheduledField]);
          scheduled = !!date;
        }
        if (!date) {
          if (!src.skipUndated) undated.push({ kind: src.kind, case_id: c.case_id, group_seq: c.group_seq, title });
          continue;
        }
        events.push({
          kind: src.kind,
          case_id: c.case_id,
          group_seq: c.group_seq,
          entity: src.entity,
          row_id: id,
          date,
          year: date.slice(0, 4),
          title: scheduled ? `Scheduled procedure · ${title}` : title,
          detail,
          ...(src.kind === 'procedure' ? { procedure_id: id } : {}),
          ...(scheduled ? { scheduled } : {}),
        });
      }
    }
  }
  // Newest first; as plain text, so a partial date ("2026-03") comes after that month's full dates.
  events.sort((a, b) => b.date.localeCompare(a.date) || b.group_seq - a.group_seq);
  undated.sort((a, b) => b.group_seq - a.group_seq);
  return { events, undated };
}

/** Events in year groups, newest year first. */
export function byYear(events: TimelineEvent[]): { year: string; events: TimelineEvent[] }[] {
  const out: { year: string; events: TimelineEvent[] }[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last?.year === e.year) last.events.push(e);
    else out.push({ year: e.year, events: [e] });
  }
  return out;
}
