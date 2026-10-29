// Dashboard tab (phase 9, EP Workspace; Admin only since step 5, My work has its own tab): cohorts, collection progress
// and clinical counts per procedure (counts only, no MRNs).
import { useCallback, useEffect, useState } from 'react';
import { applyFilters, clearFilters, itemColor, itemLabel, setFilters, useFilters, useTagged } from '../lib/filters';
import { downloadTable, downloadXlsx } from '../lib/exportFile';
import { periodPresets } from '../components/CategoryTree';
import { PeriodSheet } from '../components/PeriodSheet';
import { Sheet } from '../components/ui';
import { Icon } from '../components/Icon';
import { api, ApiError } from '../lib/api';
import { useStore } from '../store';
import { CategoryTree } from '../components/CategoryTree';

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
  progress: Tally & { in_progress: number; groups: number; collectors: number; by_group: (Tally & { name: string })[]; by_collector: (Tally & { name: string })[]; by_category: { id: string; label: string; total: number; completed: number }[]; by_month: { month: string; completed: number; in_progress: number }[] };
  clinical: {
    basis: string;
    cases: number;
    procedures: number;
    months: string[];
    by_type: { id: string; label: string; procedures: number; by_month: Record<string, number>; no_date: number }[];
    acute_success: { id: string; label: string; procedures: number; success: number; not_success: number; not_counted: number; not_recorded: number; not_determined: number; pct: number | null }[];
    complications: { reviewed: number; present: number; not_reviewed: number; pct: number | null };
    pilgrim: Record<string, number>;
    hajj_split: { id: string; label: string; hajj: number; rest: number; no_date: number }[];
    complications_split: Record<'hajj' | 'rest', { reviewed: number; present: number }>;
  };
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

/** Small Excel button on a dashboard table (owner, step 7): counts only, built in the browser. */
function ExcelBtn({ title, rows }: { title: string; rows: () => (string | number | null)[][] }) {
  const { toast } = useStore();
  return (
    <button type="button" className="btn small excel-btn" onClick={() => toast({ message: `Downloaded ${downloadTable(title, rows())}`, kind: 'success' })} aria-label={`${title} to Excel`}>
      <Icon name="download" size={14} /> Excel
    </button>
  );
}

/** Cases by month of the episode start, Completed under In progress (owner, step 7). */
function MonthChart({ data }: { data: Dashboard['progress']['by_month'] }) {
  // Every month from the first to the last, so a month with no case shows as an empty slot (last 12 shown).
  const filled: typeof data = [];
  if (data.length) {
    const have = new Map(data.map((m) => [m.month, m]));
    let [y, mo] = data[0].month.split('-').map(Number);
    const end = data[data.length - 1].month;
    for (;;) {
      const key = `${y}-${String(mo).padStart(2, '0')}`;
      filled.push(have.get(key) ?? { month: key, completed: 0, in_progress: 0 });
      if (key >= end) break;
      mo = mo === 12 ? 1 : mo + 1;
      if (mo === 1) y++;
    }
  }
  const last = filled.slice(-12);
  const max = Math.max(1, ...last.map((m) => m.completed + m.in_progress));
  const w = 100 / Math.max(1, last.length);
  return (
    <div className="month-chart" data-testid="month-chart">
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" role="img" aria-label={`Cases by month: ${last.map((m) => `${monthLabel(m.month)} ${m.completed + m.in_progress}`).join(', ')}`}>
        {last.map((m, i) => {
          const hc = (m.completed / max) * 48;
          const hp = (m.in_progress / max) * 48;
          return (
            <g key={m.month}>
              <rect x={i * w + w * 0.15} y={50 - hc} width={w * 0.7} height={hc} className="bar-done" />
              <rect x={i * w + w * 0.15} y={50 - hc - hp} width={w * 0.7} height={hp} className="bar-open" />
            </g>
          );
        })}
      </svg>
      <div className="month-axis" style={{ gridTemplateColumns: `repeat(${Math.max(1, last.length)}, minmax(0, 1fr))` }}>
        {last.map((m) => (
          <span key={m.month}>{monthLabel(m.month).split(' ')[0]}</span>
        ))}
      </div>
      <div className="legend">
        <span>
          <i className="c" /> Completed
        </span>
        <span>
          <i className="open" /> In progress
        </span>
      </div>
    </div>
  );
}

/** Statistics file (owner, step 7): period, Completed only or all, one row per procedure or case, groups. */
function StatsFileSheet({ onClose }: { onClose: () => void }) {
  const { groups, toast } = useStore();
  const presets = periodPresets().filter(([t]) => t === 'This year' || t === 'Last year' || t.startsWith('Hajj season'));
  const choices: [string, string | null, string | null][] = [...presets, ['All dates', null, null]];
  const [period, setPeriod] = useState<[string | null, string | null]>([choices[0][1], choices[0][2]]);
  const [basis, setBasis] = useState<'COMPLETED' | 'ALL'>('COMPLETED');
  const [per, setPer] = useState<'PROCEDURE' | 'CASE'>('PROCEDURE');
  const [sel, setSel] = useState<string[]>(groups.map((g) => g.group_id));
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      toast({ message: `Downloaded ${await downloadXlsx({ from: period[0], to: period[1], basis, per, group_ids: sel }, '/api/exports/stats')}`, kind: 'success' });
      onClose();
    } catch (e) {
      toast({ message: (e as ApiError).message, kind: 'error' });
      setBusy(false);
    }
  };
  return (
    <Sheet title="Statistics File" onClose={onClose} testId="stats-sheet">
      <div className="card pad prefs">
        <div className="pref">
          <span>Period (procedure date)</span>
          <div className="chip-pick" role="radiogroup" aria-label="Period">
            {choices.map(([t, a, b]) => {
              const on = period[0] === a && period[1] === b;
              return (
                <button key={t} type="button" role="radio" aria-checked={on} className={`chip filter-chip quick${on ? ' on' : ''}`} onClick={() => setPeriod([a, b])}>
                  {t}
                </button>
              );
            })}
          </div>
          <div className="date-pair">
            <label>
              From <input type="date" value={period[0] ?? ''} onChange={(e) => setPeriod([e.target.value || null, period[1]])} />
            </label>
            <label>
              To <input type="date" value={period[1] ?? ''} onChange={(e) => setPeriod([period[0], e.target.value || null])} />
            </label>
          </div>
        </div>
        <div className="pref">
          <span>Cases</span>
          <div className="seg" role="radiogroup" aria-label="Cases">
            {(
              [
                ['COMPLETED', 'Completed only'],
                ['ALL', 'All'],
              ] as const
            ).map(([k, t]) => (
              <button key={k} type="button" role="radio" aria-checked={basis === k} className={basis === k ? 'on' : ''} onClick={() => setBasis(k)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="pref">
          <span>One row per</span>
          <div className="seg" role="radiogroup" aria-label="One row per">
            {(
              [
                ['PROCEDURE', 'Procedure'],
                ['CASE', 'Case'],
              ] as const
            ).map(([k, t]) => (
              <button key={k} type="button" role="radio" aria-checked={per === k} className={per === k ? 'on' : ''} onClick={() => setPer(k)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        {groups.length > 1 && (
          <div className="pref">
            <span>Groups</span>
            <div className="chip-pick">
              {groups.map((g) => {
                const on = sel.includes(g.group_id);
                return (
                  <button key={g.group_id} type="button" aria-pressed={on} className={`chip filter-chip quick${on ? ' on' : ''}`} onClick={() => setSel(on ? sel.filter((x) => x !== g.group_id) : [...sel, g.group_id])}>
                    {on ? '✓ ' : ''}
                    {g.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <p className="note">Values in words, dates as dates. A "Columns" sheet explains each column and lists the codes. No names: MRN and age only. The full Sheet copy (all tabs, codes) stays in Settings.</p>
      <button className="btn primary block" onClick={run} disabled={busy || !sel.length} data-testid="stats-download">
        {busy ? 'Preparing…' : 'Download Excel'}
      </button>
    </Sheet>
  );
}

/** Period chips at the top of the Dashboard (owner, step 7); they set the same period as the menu. */
function PeriodChips() {
  const f = useFilters();
  const [custom, setCustom] = useState(false);
  const today = new Date();
  const y12 = new Date(today);
  y12.setFullYear(today.getFullYear() - 1);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const presets = periodPresets();
  const year = presets.find(([t]) => t === 'This year');
  const hajj = presets.find(([t]) => t.startsWith('Hajj season'));
  const list: [string, string, string][] = [...(year ? [year] : []), ['Last 12 months', iso(y12), iso(today)], ...(hajj ? [hajj] : [])];
  const isCustom = !!(f.from || f.to) && !list.some(([, a, b]) => f.from === a && f.to === b);
  return (
    <div className="filter-bar dash-period" role="radiogroup" aria-label="Dashboard period">
      {list.map(([t, a, b]) => {
        const on = f.from === a && f.to === b;
        return (
          <button key={t} type="button" role="radio" aria-checked={on} className={`chip filter-chip quick${on ? ' on' : ''}`} onClick={() => setFilters(on ? { from: null, to: null } : { from: a, to: b })}>
            {t}
          </button>
        );
      })}
      <button type="button" className={`chip filter-chip quick${isCustom ? ' on' : ''}`} onClick={() => setCustom(true)}>
        {isCustom ? `${f.from ?? '…'} – ${f.to ?? '…'}` : 'Custom…'}
      </button>
      {custom && <PeriodSheet onClose={() => setCustom(false)} />}
    </div>
  );
}

const tallyRows = (t: { name: string; total: number; completed: number; started: number; mrn_only: number; stale: number }[], first: string) => [[first, 'Cases', 'Completed', 'Started', 'MRN only', 'No change'], ...t.map((r) => [r.name, r.total, r.completed, r.started, r.mrn_only, r.stale])];

function AdminDashboard() {
  const { groups, cases } = useStore();
  const [statsFile, setStatsFile] = useState(false);
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
              <span>In progress</span>
              <b>{p.in_progress}</b>
              <small>{p.mrn_only} MRN only</small>
            </div>
            <div className="kpi warn" data-testid="kpi-no-change">
              <span>No change {d.stale_days}+ days</span>
              <b>{p.stale}</b>
              <small>In progress, untouched</small>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h3>Cases by month</h3>
              <ExcelBtn title="Cases by month" rows={() => [['Month', 'Completed', 'In progress', 'Total'], ...p.by_month.map((m) => [m.month, m.completed, m.in_progress, m.completed + m.in_progress])]} />
            </div>
            <p className="hint">Month of the episode start date.</p>
            {p.by_month.length ? <MonthChart data={p.by_month} /> : <p className="muted">No dates yet.</p>}
          </div>
          <div className="sechead-row">
            <h2 className="sechead">By group</h2>
            <ExcelBtn title="Cases by group" rows={() => tallyRows(p.by_group, 'Group')} />
          </div>
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
          <div className="sechead-row">
            <h2 className="sechead">By collector</h2>
            <ExcelBtn title="Cases by collector" rows={() => tallyRows(p.by_collector, 'Collector')} />
          </div>
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
            <div className="panel-head">
              <h3>Procedures by type and month</h3>
              <ExcelBtn title="Procedures by type and month" rows={() => [['Type', ...c.months, 'No date', 'Total'], ...c.by_type.map((t) => [t.label, ...c.months.map((m) => t.by_month[m] ?? 0), t.no_date, t.procedures])]} />
            </div>
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
            <div className="panel-head">
              <h3>Acute success by type</h3>
              <ExcelBtn title="Acute success by type" rows={() => [['Type', 'Procedures', 'Success', 'Partial / failed', 'Not recorded / not determined', 'Acute success %'], ...c.acute_success.map((a) => [a.label, a.procedures, a.success, a.not_success, a.not_recorded + a.not_counted + a.not_determined, a.pct])]} />
            </div>
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
          <div className="panel" data-testid="hajj-split">
            <div className="panel-head">
              <h3>Hajj season vs rest of year</h3>
              <ExcelBtn title="Hajj season vs rest of year" rows={() => [['Type', 'Hajj season', 'Rest of year', 'No date'], ...c.hajj_split.map((t) => [t.label, t.hajj, t.rest, t.no_date])]} />
            </div>
            <p className="hint">By procedure date; Hajj season = 1 Dhu al-Qa'dah to 15 Muharram, any patient.</p>
            {!c.hajj_split.some((t) => t.hajj + t.rest) && <p className="muted">No dated procedures in these cases yet.</p>}
            <div className="tscroll">
              <table className="dt">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th className="n">Hajj season</th>
                    <th className="n">Rest of year</th>
                  </tr>
                </thead>
                <tbody>
                  {c.hajj_split
                    .filter((t) => t.hajj + t.rest > 0)
                    .map((t) => (
                      <tr key={t.id}>
                        <th scope="row">{t.label}</th>
                        <td className="n">
                          <b className="hajj-n">{t.hajj}</b>
                        </td>
                        <td className="n">{t.rest}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              Complications: Hajj season {c.complications_split.hajj.present} of {c.complications_split.hajj.reviewed} reviewed ({pct(c.complications_split.hajj.present, c.complications_split.hajj.reviewed)}) · rest {c.complications_split.rest.present} of {c.complications_split.rest.reviewed} ({pct(c.complications_split.rest.present, c.complications_split.rest.reviewed)})
            </p>
          </div>
          <div className="panel stats-file">
            <span className="grow">
              <b>Statistics file</b>
              <span className="muted small block">Excel ready for analysis: one row per procedure, values in words</span>
            </span>
            <button className="btn primary" onClick={() => setStatsFile(true)} data-testid="stats-file">
              Download…
            </button>
          </div>
          {statsFile && <StatsFileSheet onClose={() => setStatsFile(false)} />}
          <p className="muted small">Updated {new Date(d.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        </>
      )}
    </div>
  );
}

/** Dashboard tab (Admin): cohorts (moved here from the menu, owner step 5) and the numbers, which follow them. */
export function StatsView() {
  return (
    <section className="view" aria-label="Dashboard">
      <h1 className="large-title">Dashboard</h1>
      <PeriodChips />
      <CohortsPanel />
      <AdminDashboard />
    </section>
  );
}

function CohortsPanel() {
  const { cases } = useStore();
  const f = useFilters();
  const tagged = useTagged(cases);
  const n = f.group.length ? applyFilters(cases, tagged, { ...f, grp: 'ALL' }).length : 0;
  return (
    <div className="panel cohorts-panel" data-testid="cohorts-panel">
      <CategoryTree cases={cases} show="cohorts" />
      {n > 0 && (
        <a className="link strong show-cases" href="#/cases" data-testid="show-cohort-cases">
          Show these {n} case{n === 1 ? '' : 's'} →
        </a>
      )}
    </div>
  );
}
