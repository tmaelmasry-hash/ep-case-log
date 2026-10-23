// Dashboard tab (phase 9, EP Workspace): "My work" for everyone (own open cases, what is missing, reminders) and the
// Admin dashboard (collection progress and clinical counts per procedure; counts only, no MRNs).
import { useCallback, useEffect, useState } from 'react';
import { applyFilters, clearFilters, itemColor, itemLabel, useFilters, useTagged } from '../lib/filters';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { Icon } from '../components/Icon';
import { Empty } from '../components/ui';

interface Tally {
  total: number;
  completed: number;
  started: number;
  mrn_only: number;
  stale: number;
}
interface Dashboard {
  generated_at: string;
  stale_days: number;
  progress: Tally & { in_progress: number; groups: number; collectors: number; by_group: (Tally & { name: string })[]; by_collector: (Tally & { name: string })[]; by_category: { id: string; label: string; total: number; completed: number }[] };
  clinical: {
    basis: string;
    cases: number;
    procedures: number;
    months: string[];
    by_type: { id: string; label: string; procedures: number; by_month: Record<string, number>; no_date: number }[];
    acute_success: { id: string; label: string; procedures: number; success: number; not_success: number; not_counted: number; not_recorded: number; not_determined: number; pct: number | null }[];
    complications: { reviewed: number; present: number; not_reviewed: number; pct: number | null };
    pilgrim: Record<string, number>;
  };
}
interface MyWork {
  stale_days: number;
  totals: { mine: number; in_progress: number; completed: number };
  reminders: { kind: string; text: string; count: number }[];
  items: { case_id: string; group_name: string | null; group_seq: number; mrn: string; stage: string; core_done: number; core_total: number; stale: boolean; ready: boolean; missing: string[]; missing_more: number }[];
}

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
};

function useLoad<T>(path: string | null, body?: unknown) {
  const key = body === undefined ? '' : JSON.stringify(body);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    setError(null);
    try {
      setData(await (body === undefined ? api<T>('GET', path) : api<T>('POST', path, body)));
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, [path, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, load };
}

function Bar({ t }: { t: Tally }) {
  const w = (n: number) => `${t.total ? (100 * n) / t.total : 0}%`;
  return (
    <span className="sbar" role="img" aria-label={`${t.completed} completed, ${t.started} started, ${t.mrn_only} MRN only`}>
      <i className="c" style={{ width: w(t.completed) }} />
      <i className="s" style={{ width: w(t.started) }} />
    </span>
  );
}

function TallyTable({ rows, first }: { rows: (Tally & { name: string })[]; first: string }) {
  return (
    <div className="tscroll">
      <table className="dt">
        <thead>
          <tr>
            <th>{first}</th>
            <th className="n">Cases</th>
            <th className="bar">Progress</th>
            <th className="n">Completed</th>
            <th className="n">Stale</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <th scope="row">{r.name}</th>
              <td className="n">{r.total}</td>
              <td className="bar">
                <Bar t={r} />
              </td>
              <td className="n">{r.completed}</td>
              <td className={`n ${r.stale ? 'warn-text' : 'muted'}`}>{r.stale}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminDashboard() {
  const { groups, cases } = useStore();
  const [group, setGroup] = useState('ALL');
  const [basis, setBasis] = useState<'COMPLETED' | 'ALL'>('COMPLETED');
  // The Dashboard follows the menu's procedures, cohorts and period (owner R2-8); its own group switcher stays.
  const f = useFilters();
  const tagged = useTagged(cases);
  const filtering = !!(f.proc.length || f.group.length || f.from || f.to);
  const caseIds = filtering ? applyFilters(cases, tagged, { ...f, grp: 'ALL' }).map((c) => c.case_id) : undefined;
  const { data: d, error, load } = useLoad<Dashboard>(`/api/dashboard?group=${encodeURIComponent(group)}&basis=${basis}`, caseIds ? { group, basis, case_ids: caseIds } : undefined);
  if (error)
    return (
      <p className="field-error" role="alert">
        {error}{' '}
        <button className="link strong" onClick={load}>
          Try again
        </button>
      </p>
    );
  const p = d?.progress;
  const c = d?.clinical;
  const pct = (a: number, b: number) => (b ? `${Math.round((1000 * a) / b) / 10}%` : '—');
  return (
    <div data-testid="dashboard">
      {filtering && (
        <p className="filter-bar" data-testid="dashboard-filter">
          <span className="muted small">Showing</span>
          {[...f.proc, ...f.group].map((id) => (
            <span key={id} className="chip c-cat" style={{ ['--chip' as string]: `var(--${itemColor(id)})` }}>
              {itemLabel(id)}
            </span>
          ))}
          {(f.from || f.to) && <span className="chip c-neutral">{`${f.from ?? '…'} – ${f.to ?? '…'}`}</span>}
          <button type="button" className="link small" onClick={clearFilters}>
            All cases
          </button>
        </p>
      )}
      {groups.length > 1 && (
        <div className="seg" role="radiogroup" aria-label="Dashboard group">
          {[{ group_id: 'ALL', name: 'All groups' }, ...groups].map((g) => (
            <button key={g.group_id} type="button" role="radio" aria-checked={group === g.group_id} className={group === g.group_id ? 'on' : ''} onClick={() => setGroup(g.group_id)}>
              {g.name}
            </button>
          ))}
        </div>
      )}
      {!d || !p || !c ? (
        <p className="muted">
          <span className="spinner inline" /> Loading…
        </p>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <span>Cases</span>
              <b>{p.total}</b>
              <small>
                {p.groups} group{p.groups === 1 ? '' : 's'} · {p.collectors} collector{p.collectors === 1 ? '' : 's'}
              </small>
            </div>
            <div className="kpi ok">
              <span>Completed</span>
              <b>{p.completed}</b>
              <small>{pct(p.completed, p.total)} of all</small>
            </div>
            <div className="kpi ip">
              <span>Started</span>
              <b>{p.started}</b>
              <small>{p.mrn_only} MRN only</small>
            </div>
            <div className="kpi warn">
              <span>Stale</span>
              <b>{p.stale}</b>
              <small>no change &gt; {d.stale_days} days</small>
            </div>
          </div>
          <h2 className="sechead">By group</h2>
          <div className="panel">
            <TallyTable rows={p.by_group} first="Group" />
            <div className="legend">
              <span>
                <i className="c" /> Completed
              </span>
              <span>
                <i className="s" /> Started
              </span>
              <span>
                <i /> MRN only
              </span>
            </div>
          </div>
          <h2 className="sechead">By collector</h2>
          <div className="panel">{p.by_collector.length ? <TallyTable rows={p.by_collector} first="Collector" /> : <p className="muted">No cases yet.</p>}</div>
          <h2 className="sechead">By procedure type (cases)</h2>
          <div className="panel">
            {p.by_category.map((x) => (
              <div key={x.id} className="cbar">
                <span className="cl">{x.label}</span>
                <span className="sbar">
                  <i className="c" style={{ width: `${x.total ? (100 * x.completed) / x.total : 0}%` }} />
                </span>
                <span className="cn">
                  {x.completed} / {x.total}
                </span>
              </div>
            ))}
          </div>

          <div className="dash-sec">
            <h2 className="sechead">Clinical counts</h2>
            <div className="mini-seg" role="radiogroup" aria-label="Which cases the clinical counts use">
              {(
                [
                  ['COMPLETED', 'Completed only'],
                  ['ALL', 'Include In progress'],
                ] as const
              ).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={basis === v} className={basis === v ? 'on' : ''} onClick={() => setBasis(v)}>
                  {l}
                </button>
              ))}
            </div>
            <p className="muted small">
              {c.procedures} procedure{c.procedures === 1 ? '' : 's'} in {c.cases} {basis === 'ALL' ? 'Completed and In-progress' : 'Completed'} case{c.cases === 1 ? '' : 's'}. Counts only — no outcome analytics.
            </p>
          </div>
          <div className="panel">
            <h3>Procedures by type and month</h3>
            <p className="hint">Month of the procedure start date.</p>
            <div className="tscroll">
              <table className="dt" data-testid="by-type">
                <thead>
                  <tr>
                    <th>Type</th>
                    {c.months.map((m) => (
                      <th key={m} className="n">
                        {monthLabel(m)}
                      </th>
                    ))}
                    <th className="n">No date</th>
                    <th className="n">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {c.by_type.map((t) => (
                    <tr key={t.id}>
                      <th scope="row">{t.label}</th>
                      {c.months.map((m) => (
                        <td key={m} className="n">
                          {t.by_month[m] ?? '·'}
                        </td>
                      ))}
                      <td className="n muted">{t.no_date}</td>
                      <td className="n">
                        <b>{t.procedures}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel">
            <h3>Acute success by type</h3>
            <p className="hint">From each type's acute endpoint field, as in the dictionary roll-up. AF counts as success only with the PV requirement met and the block confirmed; otherwise "not determined". % of determined procedures.</p>
            <div className="tscroll">
              <table className="dt" data-testid="acute">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th className="n">Procedures</th>
                    <th className="n">Success</th>
                    <th className="n">Partial / failed</th>
                    <th className="n">Not recorded / not determined</th>
                    <th className="n">Acute success</th>
                  </tr>
                </thead>
                <tbody>
                  {c.acute_success.map((a) => (
                    <tr key={a.id}>
                      <th scope="row">{a.label}</th>
                      <td className="n">{a.procedures}</td>
                      <td className="n">{a.success}</td>
                      <td className="n">{a.not_success}</td>
                      <td className="n muted">{a.not_recorded + a.not_counted + a.not_determined}</td>
                      <td className="n">
                        <b>{a.pct === null ? '—' : `${a.pct}%`}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel">
            <h3>Complications</h3>
            <div className="big">{c.complications.pct === null ? '—' : `${c.complications.pct}%`}</div>
            <p className="muted">
              {c.complications.present} procedure{c.complications.present === 1 ? '' : 's'} with complications present of {c.complications.reviewed} reviewed
            </p>
            <p className="hint">{c.complications.not_reviewed} not reviewed yet (not counted).</p>
            <h3>Pilgrim status (cases)</h3>
            <div className="tiles">
              {(
                [
                  ['Hajj', c.pilgrim.HAJJ ?? 0],
                  ['Umrah', c.pilgrim.UMRAH ?? 0],
                  ['Non-pilgrim', c.pilgrim.NON_PILGRIM ?? 0],
                  ['Unknown / blank', (c.pilgrim.UNKNOWN ?? 0) + (c.pilgrim.not_recorded ?? 0)],
                ] as const
              ).map(([l, n]) => (
                <div key={l} className="tile">
                  <b>{n}</b>
                  <span>{l}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="muted small">Updated {new Date(d.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        </>
      )}
    </div>
  );
}

function MyWorkView() {
  const { data: w, error, load } = useLoad<MyWork>('/api/mywork');
  if (error)
    return (
      <p className="field-error" role="alert">
        {error}{' '}
        <button className="link strong" onClick={load}>
          Try again
        </button>
      </p>
    );
  if (!w)
    return (
      <p className="muted">
        <span className="spinner inline" /> Loading…
      </p>
    );
  return (
    <div data-testid="mywork">
      <div className="kpis">
        <div className="kpi">
          <span>My cases</span>
          <b>{w.totals.mine}</b>
        </div>
        <div className="kpi ip">
          <span>In progress</span>
          <b>{w.totals.in_progress}</b>
        </div>
        <div className="kpi ok">
          <span>Completed</span>
          <b>{w.totals.completed}</b>
        </div>
      </div>
      {w.reminders.length > 0 && (
        <div className="group" data-testid="reminders">
          {w.reminders.map((r) => (
            <div key={r.kind} className="grow-row check-item">
              <span className={`ic ${r.kind === 'ready' ? 'ok' : 'warn'}`}>{r.kind === 'ready' ? '✓' : 'i'}</span>
              <span className="grow">{r.text}</span>
            </div>
          ))}
        </div>
      )}
      <h2 className="sechead">My open cases</h2>
      {!w.items.length ? (
        <Empty icon="check" title="Nothing open">
          <p>Cases you add or edit appear here until they are completed.</p>
        </Empty>
      ) : (
        <div className="group">
          {w.items.map((x) => (
            <a key={x.case_id} className="grow-row" href={`#/cases/${x.case_id}`} data-testid="mywork-row">
              <span className="grow">
                <span className="line1">
                  <b>{x.mrn}</b>{' '}
                  <span className="muted">
                    · {x.group_name} No. {x.group_seq}
                  </span>
                  {x.ready && <span className="status s-done"> Ready to complete</span>}
                  {x.stale && <span className="kind"> STALE</span>}
                </span>
                <span className="sub">
                  core {x.core_done}/{x.core_total}
                  {x.missing.length ? ` · missing: ${x.missing.join(', ')}${x.missing_more ? ` and ${x.missing_more} more` : ''}` : ''}
                </span>
              </span>
              <Icon name="chevron" size={16} className="muted" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatsView() {
  const { can } = useAuth();
  const admin = can('dashboard.view');
  const [view, setView] = useState<'mywork' | 'dashboard'>(() => {
    try {
      return admin && localStorage.getItem('ep.dash.view') === 'dashboard' ? 'dashboard' : 'mywork';
    } catch {
      return 'mywork';
    }
  });
  const pick = (v: 'mywork' | 'dashboard') => {
    setView(v);
    try {
      localStorage.setItem('ep.dash.view', v);
    } catch {
      /* storage blocked */
    }
  };
  return (
    <section className="view" aria-label="Dashboard">
      <h1 className="large-title">{view === 'dashboard' ? 'Dashboard' : 'My Work'}</h1>
      {admin && (
        <div className="seg" role="radiogroup" aria-label="View">
          <button type="button" role="radio" aria-checked={view === 'mywork'} className={view === 'mywork' ? 'on' : ''} onClick={() => pick('mywork')}>
            My work
          </button>
          <button type="button" role="radio" aria-checked={view === 'dashboard'} className={view === 'dashboard' ? 'on' : ''} onClick={() => pick('dashboard')}>
            Dashboard
          </button>
        </div>
      )}
      {view === 'dashboard' && admin ? <AdminDashboard /> : <MyWorkView />}
    </section>
  );
}
