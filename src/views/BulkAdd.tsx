// Bulk add MRNs (phase 6, Admin; EP Workspace F-03): paste → Review (nothing saved) → Add → results.
import { useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { todayISO } from '../lib/util';
import { useStore } from '../store';
import { Sheet } from '../components/ui';
import { fieldOf } from '../lib/dict';

/** Owner step 6: one procedure type for the whole list, a dictionary component code kept as a "planned" mark. */
const PLANNED = (fieldOf('PROCEDURE_COMPONENTS', 'component_type').codes ?? []).filter((c) => c.code !== 'OTHER');

interface Row {
  position: number;
  line: number;
  input: string;
  value: string;
  status: 'READY' | 'REPEATED' | 'ALREADY_HERE' | 'INVALID';
  message: string;
  warning?: string;
}
interface Preview {
  rows: Row[];
  summary: { total: number; ready: number; repeated: number; already_here: number; other_group: number; invalid: number; warnings: number };
  numbers: { from: number; to: number } | null;
  preview_token: string;
}
interface Result {
  added: number;
  replayed: boolean;
  rows: { position: number; mrn: string; outcome: string; case_id: string | null; group_seq: number | null; message: string | null }[];
}

const STATUS: Record<string, string> = { READY: 'Ready', ADDED: 'Added', REPEATED: 'Repeated', ALREADY_HERE: 'Already here', INVALID: 'Not valid' };

export function BulkAddSheet({ onClose, defaultGroup }: { onClose: () => void; defaultGroup: string }) {
  const { groups, refreshCases, toast } = useStore();
  const [group, setGroup] = useState(defaultGroup);
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ticked, setTicked] = useState<number[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [planned, setPlanned] = useState<string | null>(null);
  const key = useMemo(() => `bulk-${crypto.randomUUID()}`, [preview]); // one key per reviewed list: a second click is the same add
  const body = { group_id: group, text, ...(date ? { episode_start_date: date } : {}), ...(planned ? { planned_type: planned } : {}) };
  const reset = () => {
    setPreview(null);
    setTicked([]);
    setErr(null);
  };

  const review = async () => {
    setBusy(true);
    setErr(null);
    try {
      setPreview(await api<Preview>('POST', '/api/imports/mrns/preview', body));
      setTicked([]);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!preview) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<Result>('POST', '/api/imports/mrns/commit', { ...body, preview_token: preview.preview_token, idempotency_key: key, add_existing: ticked });
      setResult(r);
      await refreshCases();
      toast({ message: `${r.added} case${r.added === 1 ? '' : 's'} added`, kind: 'success' });
    } catch (e) {
      const a = e as ApiError;
      setErr(a.message);
      if (a.code === 'STALE_PREVIEW') setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const willAdd = (preview?.summary.ready ?? 0) + ticked.length;

  return (
    <Sheet title="Bulk Add MRNs" closeLabel="Close" onClose={onClose} onDone={onClose} testId="bulk-sheet">
      {result ? (
        <>
          <p className="muted small">{result.replayed ? 'This list was already added; here is the result.' : `${result.added} case${result.added === 1 ? '' : 's'} added.`}</p>
          <div className="group" data-testid="bulk-results">
            {result.rows.map((r) => (
              <div key={r.position} className="grow-row">
                <span className="grow">
                  <span className="line1">
                    <b>{r.mrn}</b> <span className={`kind ${r.outcome === 'ADDED' ? 'add' : r.outcome === 'INVALID' ? 'del' : ''}`}>{STATUS[r.outcome] ?? r.outcome}</span>
                  </span>
                  <span className="sub">
                    {r.group_seq ? `No. ${r.group_seq}` : ''}
                    {r.message ? `${r.group_seq ? ' · ' : ''}${r.message}` : ''}
                  </span>
                </span>
                {r.case_id && (
                  <a className="link small" href={`#/cases/${r.case_id}`} onClick={onClose}>
                    Open
                  </a>
                )}
              </div>
            ))}
          </div>
          <button
            className="btn block"
            onClick={() => {
              setResult(null);
              setText('');
              reset();
            }}
          >
            Add another list
          </button>
        </>
      ) : (
        <>
          <div className="group">
            {groups.length > 1 && (
              <div className="frow stack">
                <span className="lab">Group</span>
                <div className="mini-seg" role="radiogroup" aria-label="Group">
                  {groups.map((g) => (
                    <button
                      key={g.group_id}
                      type="button"
                      role="radio"
                      aria-checked={group === g.group_id}
                      className={group === g.group_id ? 'on' : ''}
                      onClick={() => {
                        setGroup(g.group_id);
                        reset();
                      }}
                    >
                      {g.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="frow stack">
              <span className="lab">Procedure type for every MRN (optional)</span>
              <div className="chip-pick" role="radiogroup" aria-label="Procedure type for every MRN" data-testid="bulk-planned">
                {PLANNED.map((c) => (
                  <button key={c.code} type="button" role="radio" aria-checked={planned === c.code} className={`chip filter-chip quick${planned === c.code ? ' on' : ''}`} onClick={() => setPlanned(planned === c.code ? null : c.code)}>
                    {c.label}
                  </button>
                ))}
              </div>
              <span className="muted small">Shown as "planned" and found by the menu until a procedure is added. No procedure is opened.</span>
            </div>
            <div className="frow inline">
              <label className="lab-wrap" htmlFor="bulk-date">
                <span className="lab">Episode start date (optional)</span>
              </label>
              <input
                id="bulk-date"
                className="ios-value"
                type="date"
                max={todayISO()}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  reset();
                }}
              />
            </div>
            <div className="frow stack">
              <label className="lab" htmlFor="bulk-text">
                MRNs
              </label>
              <textarea
                id="bulk-text"
                className="ios-text box"
                rows={6}
                placeholder="One 7-digit MRN per line, or a column copied from Excel"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  reset();
                }}
              />
            </div>
          </div>
          <p className="muted small">No clinical data is needed now. Nothing is saved until you press Add.</p>
          {err && (
            <p className="field-error" role="alert">
              {err}
            </p>
          )}
          {!preview ? (
            <button className="btn primary block" disabled={!text.trim() || busy} onClick={review}>
              {busy ? 'Checking…' : 'Review'}
            </button>
          ) : (
            <>
              <div className="summary" data-testid="bulk-summary">
                <div>
                  <b>{preview.summary.ready}</b>ready
                </div>
                <div>
                  <b>{preview.summary.already_here}</b>already here
                </div>
                <div>
                  <b className={preview.summary.invalid ? 'bad' : ''}>{preview.summary.invalid + preview.summary.repeated}</b>skipped
                </div>
              </div>
              <div className="group" data-testid="bulk-preview">
                {preview.rows.map((r) => (
                  <div key={r.position} className="grow-row">
                    <span className="grow">
                      <span className="line1">
                        <b>{r.value || r.input}</b> <span className={`kind ${r.status === 'READY' ? 'add' : r.status === 'INVALID' ? 'del' : ''}`}>{STATUS[r.status]}</span>
                      </span>
                      <span className="sub">
                        Line {r.line} · {r.message}
                        {r.warning ? ` · ${r.warning}` : ''}
                      </span>
                    </span>
                    {r.status === 'ALREADY_HERE' && (
                      <label className="small tick">
                        <input type="checkbox" checked={ticked.includes(r.position)} onChange={(e) => setTicked((t) => (e.target.checked ? [...t, r.position] : t.filter((x) => x !== r.position)))} /> New case
                      </label>
                    )}
                  </div>
                ))}
              </div>
              {preview.numbers && <p className="muted small">Numbers from No. {preview.numbers.from}{willAdd > 1 ? ` to No. ${preview.numbers.from + willAdd - 1}` : ''}.</p>}
              <button className="btn primary block" disabled={!willAdd || busy} onClick={add} data-testid="bulk-add-btn">
                {busy ? 'Adding…' : `Add ${willAdd} case${willAdd === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
