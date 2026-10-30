// Data completeness (R4-8, Admin; preview artboard MatrixGroup): one row per case, core items per section from the
// server (/api/completeness, readiness counts). MRN opens the case; Excel of the whole filtered table.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { Icon } from '../components/Icon';
import { api, ApiError } from '../lib/api';
import { downloadTable } from '../lib/exportFile';
import type { XCell } from '../../shared/xlsx.ts';

interface Count {
  applicable: number;
  recorded: number;
  not_available: number;
  missing: number;
  ai_pending: number;
}
interface Row {
  case_id: string;
  group_id: string;
  group_name: string;
  no: number;
  mrn: string;
  collection_status: string;
  procedures: string[];
  sections: Record<string, Count>;
  core: { answered: number; applicable: number };
}
interface Answer {
  sections: { id: string; label: string }[];
  total: number;
  page: number;
  page_size: number;
  rows: Row[];
}

const query = (group: string, inProgress: boolean, page: number | 'all') => `/api/completeness?group=${encodeURIComponent(group)}&status=${inProgress ? 'in_progress' : 'all'}&page=${page}`;

/** ✓ all answered · number of missing (amber) · AI waiting for review (blue) · — nothing required. */
function cellText(c: Count): XCell {
  if (!c.applicable) return '—';
  if (c.missing) return c.ai_pending ? `${c.missing} + AI` : c.missing;
  return c.ai_pending ? 'AI' : '✓';
}

function Cell({ c }: { c: Count }) {
  if (!c.applicable) return <span className="cm-none" aria-label="Nothing required">—</span>;
  if (!c.missing && !c.ai_pending) return <span className="cm-chip ok" aria-label="All answered">✓</span>;
  return (
    <>
      {c.missing > 0 && (
        <span className="cm-chip miss" aria-label={`${c.missing} missing`}>
          {c.missing}
        </span>
      )}
      {c.ai_pending > 0 && (
        <span className="cm-chip ai" aria-label={`${c.ai_pending} AI value${c.ai_pending === 1 ? '' : 's'} waiting for review`}>
          AI
        </span>
      )}
    </>
  );
}

export function CompletenessView() {
  const { can } = useAuth();
  const { groups, toast } = useStore();
  const [group, setGroup] = useState('all');
  const [inProgress, setInProgress] = useState(true);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api<Answer>('GET', query(group, inProgress, page)));
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, [group, inProgress, page]);
  useEffect(() => {
    if (can('dashboard.view')) void load();
  }, [load, can]);

  if (!can('dashboard.view'))
    return (
      <section className="view">
        <p className="muted">Admin only.</p>
      </section>
    );

  const excel = async () => {
    setBusy(true);
    try {
      const all = await api<Answer>('GET', query(group, inProgress, 'all'));
      const rows: XCell[][] = [
        ['Group', 'No.', 'MRN', 'Procedure', 'Status', ...all.sections.map((s) => s.label), 'Core answered', 'Core applicable'],
        ...all.rows.map((r) => [r.group_name, r.no, r.mrn, r.procedures.join('; '), r.collection_status === 'COMPLETED' ? 'Completed' : 'In progress', ...all.sections.map((s) => cellText(r.sections[s.id])), r.core.answered, r.core.applicable]),
      ];
      toast({ message: `Downloaded ${downloadTable('Data completeness', rows)}`, kind: 'success' });
    } catch (e) {
      toast({ message: (e as ApiError).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const first = data && data.total ? (data.page - 1) * data.page_size + 1 : 0;
  const last = data ? Math.min(data.total, data.page * data.page_size) : 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <section className="view completeness" aria-label="Data completeness" data-testid="completeness-view">
      <div className="navbar">
        <a href="#/admin" className="back link">
          <Icon name="back" size={22} /> Admin
        </a>
      </div>
      <h1 className="large-title">Data completeness</h1>
      <p className="muted small">One row per case. The same MRN with several cases has several rows.</p>
      <div className="cm-tools">
        <label className="chip c-neutral filter-chip select-chip">
          <select
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              setPage(1);
            }}
            aria-label="Group"
            data-testid="cm-group"
          >
            <option value="all">All groups</option>
            {groups.map((g) => (
              <option key={g.group_id} value={g.group_id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`chip filter-chip quick${inProgress ? ' on' : ''}`}
          aria-pressed={inProgress}
          onClick={() => {
            setInProgress(!inProgress);
            setPage(1);
          }}
          data-testid="cm-in-progress"
        >
          In progress only
        </button>
        <button type="button" className="btn small excel-btn" onClick={excel} disabled={busy || !data?.total} data-testid="cm-excel" aria-label="Data completeness to Excel">
          <Icon name="download" size={14} /> {busy ? 'Preparing…' : 'Excel'}
        </button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <div className="panel">
          {data.rows.length ? (
            <div className="tscroll">
              <table className="dt cm-table" data-testid="cm-table">
                <thead>
                  <tr>
                    {group === 'all' && <th>Group</th>}
                    <th className="n">No.</th>
                    <th>MRN</th>
                    <th>Procedure</th>
                    {data.sections.map((s) => (
                      <th key={s.id} className="c">
                        {s.label}
                      </th>
                    ))}
                    <th className="c">Core answered</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.case_id} data-testid="cm-row">
                      {group === 'all' && <td className="muted">{r.group_name}</td>}
                      <td className="n muted">{r.no}</td>
                      <td>
                        <a className="cm-mrn" href={`#/cases/${r.case_id}`} data-testid="cm-mrn">
                          {r.mrn}
                        </a>
                      </td>
                      <td className="cm-proc">{r.procedures.join(', ') || <span className="muted">No procedure yet</span>}</td>
                      {data.sections.map((s) => (
                        <td key={s.id} className="c" data-section={s.id}>
                          <Cell c={r.sections[s.id]} />
                        </td>
                      ))}
                      <td className="c cm-core">
                        {r.core.answered} / {r.core.applicable}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">{inProgress ? 'No case in progress here.' : 'No cases here yet.'}</p>
          )}
        </div>
      )}
      {data && data.total > 0 && (
        <div className="cm-foot">
          <span className="cm-legend">
            <span className="cm-chip ok">✓</span> all answered <span className="cm-chip miss">2</span> missing items <span className="cm-chip ai">AI</span> waiting for review <span className="cm-none">—</span> nothing required
          </span>
          <span className="cm-pager" data-testid="cm-pager">
            <button type="button" className="btn small" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
              ‹
            </button>
            <span>
              {first}–{last} of {data.total}
            </span>
            <button type="button" className="btn small" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page" data-testid="cm-next">
              ›
            </button>
          </span>
        </div>
      )}
      <p className="muted small">Core answered counts recorded + not available with a reason.</p>
    </section>
  );
}
