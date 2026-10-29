// My work (owner, step 5): the first screen on opening. Done this week, open and ready counts, then the user's open
// cases with the fewest missing first. Members also see cases nobody has filled in yet in their groups (owner, 28 Oct).
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api, ApiError } from '../lib/api';
import { ageSex, fmtDate } from '../lib/util';
import { groupColor } from '../lib/filters';
import { useStore } from '../store';
import { Icon } from '../components/Icon';
import { Empty, SaveIndicator } from '../components/ui';
import { pilgrimMark, procedureChip } from './CasesView';

export interface MyWork {
  stale_days: number;
  totals: { mine: number; in_progress: number; completed: number; ready: number; done_this_week: number };
  reminders: { kind: string; text: string; count: number }[];
  items: { case_id: string; group_name: string | null; group_seq: number; mrn: string; stage: string; core_done: number; core_total: number; missing_count: number; stale: boolean; ready: boolean; missing: string[]; missing_more: number }[];
}

export function useMyWork() {
  const { cases } = useStore();
  const [data, setData] = useState<MyWork | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api<MyWork>('GET', '/api/mywork'));
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, []);
  // Reload when the cases change (a save or Completed elsewhere in the app).
  useEffect(() => {
    load();
  }, [load, cases]);
  return { data, error, load };
}

type Item = MyWork['items'][number];

export function MyWorkRow({ x, staleDays, compact }: { x: Item; staleDays: number; compact?: boolean }) {
  const { cases, groups } = useStore();
  const c = cases.find((k) => k.case_id === x.case_id);
  const as = c ? ageSex(c.age, c.sex) : '';
  const hajj = c ? pilgrimMark(c) : null;
  const procs = c?.procedures.map((p) => procedureChip(p).text).join(' + ');
  const notStarted = x.stage === 'MRN_ONLY';
  const badge = x.ready ? (
    <span className="mw-ready">Ready — mark Completed</span>
  ) : notStarted ? (
    <span className="missing">Not started</span>
  ) : x.missing_count > 0 ? (
    <span className="missing">{x.missing_count} missing</span>
  ) : null;
  const dot = c && groups.length > 1 ? groupColor(groups, c.group_id) : null;
  return (
    <a href={`#/cases/${x.case_id}`} className="grow-row case-row" data-testid="mywork-row">
      <span className="grow">
        <span className="line1 card-top">
          <b className="card-mrn">{x.mrn}</b>
          {as ? <span className="muted card-as">{as}</span> : notStarted && <span className="muted card-as">MRN only</span>}
          {hajj && (
            <span className="chip c-cat hajj-mark" style={{ '--chip': 'var(--cat-pilgrim)' } as CSSProperties}>
              {hajj}
            </span>
          )}
          <span className="mw-badge">{badge}</span>
        </span>
        <span className="sub">
          {dot && <span className="gdot" style={{ background: `var(--${dot})` }} aria-hidden />}
          {[x.group_name, procs, c?.episode_start_date ? fmtDate(c.episode_start_date) : null].filter(Boolean).join(' · ')}
          {x.stale && <span className="missing"> · no change for more than {staleDays} days</span>}
        </span>
        {!compact && !x.ready && !notStarted && x.missing.length > 0 && (
          <span className="sub">
            Missing: {x.missing.join(', ')}
            {x.missing_more ? ` and ${x.missing_more} more` : ''}
          </span>
        )}
      </span>
      <Icon name="chevron" size={16} className="muted" />
    </a>
  );
}

export function MyWorkView() {
  const { data: w, error, load } = useMyWork();
  const reminders = useMemo(() => (w?.reminders ?? []).filter((r) => r.kind !== 'ready'), [w]);
  return (
    <section className="view" aria-label="My work" data-testid="mywork">
      <div className="navbar">
        <span className="grow" />
        <SaveIndicator />
      </div>
      <h1 className="large-title">My Work</h1>
      {error ? (
        <p className="field-error" role="alert">
          {error}{' '}
          <button className="link strong" onClick={load}>
            Try again
          </button>
        </p>
      ) : !w ? (
        <p className="muted">
          <span className="spinner inline" /> Loading…
        </p>
      ) : (
        <>
          <div className="kpis mw-kpis">
            <div className="kpi done" data-testid="done-this-week">
              <span>Done this week</span>
              <b>{w.totals.done_this_week}</b>
            </div>
            <div className="kpi">
              <span>Open</span>
              <b>{w.totals.in_progress}</b>
            </div>
            <div className="kpi ip">
              <span>Ready</span>
              <b>{w.totals.ready}</b>
            </div>
          </div>
          {reminders.length > 0 && (
            <div className="group" data-testid="reminders">
              {reminders.map((r) => (
                <div key={r.kind} className="grow-row check-item">
                  <span className="ic warn">i</span>
                  <span className="grow">{r.text}</span>
                </div>
              ))}
            </div>
          )}
          <h2 className="sechead">Open cases · fewest missing first</h2>
          {!w.items.length ? (
            <Empty icon="check" title="Nothing open">
              <p>Cases you fill in appear here until they are completed.</p>
            </Empty>
          ) : (
            <div className="group">
              {w.items.map((x) => (
                <MyWorkRow key={x.case_id} x={x} staleDays={w.stale_days} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
