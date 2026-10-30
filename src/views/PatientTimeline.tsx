// Patient timeline (owner R4-9): the recorded events of the cases of one MRN the user can see, each by its own date
// (shared/timeline.ts). Each case loads as the case screen loads it: this device's copy first, then the server's (which
// only answers for the user's groups). Offline, a case never opened on this device cannot be included.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { CaseDetail, CaseSummary, ProcedureSummary } from '../../shared/caseTypes.ts';
import { buildTimeline, byYear, fmtTimelineDate, type TimelineEvent } from '../../shared/timeline.ts';
import { api, type ApiError } from '../lib/api';
import { label } from '../lib/dict';
import { caseGet, casePut } from '../lib/localdb';
import { sync } from '../lib/sync';
import { procedureChip } from './CasesView';

type Loaded = { detail: CaseDetail | null; state: 'loading' | 'ok' | 'unavailable' };

const TYPE_COLOR: Record<string, string> = {
  ABLATION: 'cat-ablation',
  EPS: 'cat-eps',
  CIED_IMPLANT: 'cat-device',
  GENERATOR_CHANGE: 'cat-device',
  LEAD_REVISION: 'cat-device',
  EXTRACTION: 'cat-device',
  ILR: 'cat-device',
};
const KIND_COLOR: Record<string, string> = { episode: 'muted', followup: 'ok', outcome: 'danger', device_check: 'cat-device' };

function procColor(p: ProcedureSummary | undefined): string {
  if (!p) return 'cat-other';
  return procedureChip(p).color ?? (p.type && TYPE_COLOR[p.type]) ?? 'cat-other';
}

function useCaseDetails(cases: CaseSummary[]): Record<string, Loaded> {
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const ids = cases.map((c) => c.case_id).join(',');
  useEffect(() => {
    let live = true;
    const set = (id: string, l: Loaded) => live && setLoaded((m) => ({ ...m, [id]: l }));
    for (const id of ids ? ids.split(',') : []) {
      setLoaded((m) => (m[id] ? m : { ...m, [id]: { detail: null, state: 'loading' } }));
      void (async () => {
        const local = await caseGet<CaseDetail>(id);
        if (local) set(id, { detail: local, state: 'ok' });
        // A case made offline is not on the server yet: this device's copy is the case.
        if (sync.isLocalOnly(id)) {
          if (!local) set(id, { detail: null, state: 'unavailable' });
          return;
        }
        try {
          const d = await api<CaseDetail>('GET', `/api/cases/${id}`);
          void casePut(id, d);
          set(id, { detail: d, state: 'ok' });
        } catch (e) {
          if (!local) set(id, { detail: null, state: (e as ApiError).status === 404 ? 'ok' : 'unavailable' });
        }
      })();
    }
    return () => {
      live = false;
    };
  }, [ids]);
  return loaded;
}

export function PatientTimeline({ cases }: { cases: CaseSummary[] }) {
  const loaded = useCaseDetails(cases);
  const byId = useMemo(() => new Map(cases.map((c) => [c.case_id, c])), [cases]);
  const { events, undated } = useMemo(() => {
    const list = cases.flatMap((c) => {
      const d = loaded[c.case_id]?.detail;
      return d ? [{ case_id: c.case_id, group_seq: c.group_seq, rows: d.rows }] : [];
    });
    return buildTimeline(list, {
      code: (entity, field, code) => label(entity, field, code),
      procedure: (caseId, pid) => {
        const p = byId.get(caseId)?.procedures.find((x) => x.id === pid);
        return p ? procedureChip(p).text : 'Procedure';
      },
    });
  }, [cases, loaded, byId]);
  const loading = cases.some((c) => (loaded[c.case_id]?.state ?? 'loading') === 'loading');
  const missing = cases.filter((c) => loaded[c.case_id]?.state === 'unavailable');

  const dot = (e: TimelineEvent) => {
    const c = byId.get(e.case_id);
    const color = e.kind === 'procedure' ? procColor(c?.procedures.find((p) => p.id === e.procedure_id)) : (KIND_COLOR[e.kind] ?? 'info');
    return { background: `var(--${color})` } as CSSProperties;
  };
  const sub = (e: TimelineEvent) => {
    const c = byId.get(e.case_id);
    const status = c?.collection_status === 'COMPLETED' ? 'Completed' : 'In progress';
    const rest = e.kind === 'procedure' || e.kind === 'episode' ? status : e.detail;
    return `Case No. ${e.group_seq}${rest ? ` · ${rest}` : ''}`;
  };

  return (
    <div className="timeline" data-testid="patient-timeline">
      {loading && <p className="muted small">Loading the cases…</p>}
      {missing.length > 0 && (
        <p className="note" data-testid="timeline-offline">
          {missing.map((c) => `Case No. ${c.group_seq}`).join(', ')}: open this case once online to include it.
        </p>
      )}
      {!loading && !events.length && !undated.length && <p className="muted">No recorded events with a date yet.</p>}
      {byYear(events).map((g) => (
        <div key={g.year} className="tl-year">
          <h2 className="sechead">{g.year}</h2>
          <ol className="tl-list">
            {g.events.map((e) => (
              <li key={`${e.entity}.${e.row_id}.${e.case_id}`}>
                <a href={`#/cases/${e.case_id}`} className="tl-item" data-testid="timeline-event">
                  <span className="tl-rail" aria-hidden>
                    <span className="tl-dot" style={dot(e)} />
                  </span>
                  <span className="tl-body">
                    <span className="tl-date muted small">{fmtTimelineDate(e.date)}</span>
                    <b className="tl-title">{e.title}</b>
                    <span className="muted small">{sub(e)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      ))}
      {undated.length > 0 && (
        <div className="hcard tl-undated" data-testid="timeline-undated">
          <b>Without a date ({undated.length})</b>
          {undated.map((u, i) => (
            <a key={i} href={`#/cases/${u.case_id}`} className="muted small">
              {u.title} · case No. {u.group_seq}
            </a>
          ))}
        </div>
      )}
      <p className="muted small tl-foot">Only recorded events, by their own date. Planned follow-ups stay on the Follow-up tab.</p>
    </div>
  );
}
