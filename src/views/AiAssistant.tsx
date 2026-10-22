// AI Assistant (phase 11): paste a clinical note, the AI fills empty fields of this case (marked "AI" until a person
// accepts them), and lists conflicts with saved values for a person to choose. The note is sent once and never kept.
import { useEffect, useState } from 'react';
import { displayValue } from '../../shared/dictionary.ts';
import { decodeValue } from '../../shared/validate.ts';
import type { AiMark, CaseDetail } from '../../shared/caseTypes.ts';
import { dict, fieldOf } from '../lib/dict';
import { api, ApiError } from '../lib/api';
import { useStore } from '../store';
import { Sheet } from '../components/ui';
import type { CaseEditor } from '../caseEditor';

interface AiStatus {
  provider: string;
  label: string;
  model: string | null;
  configured: boolean;
  reason: string | null;
  max_note_chars: number;
  sample_notes: { id: string; title: string }[];
}

interface RunItem {
  key: string | null;
  entity: string;
  field: string;
  status: 'FILLED' | 'SAME' | 'CONFLICT' | 'DROPPED' | 'ADDITIONAL';
  value?: unknown;
  reason?: string;
}

interface RunResult {
  provider: string;
  recognised: boolean;
  summary: { filled: number; same: number; conflicts: number; dropped: number; additional: number };
  items: RunItem[];
  removed: number;
  procedure_id: string | null;
  case: CaseDetail;
}

const fieldLabel = (entity: string, field: string) => dict.entities[entity]?.fields.find((f) => f.name === field)?.label ?? field;

function show(entity: string, field: string, stored: unknown): string {
  const f = fieldOf(entity, field);
  return f ? displayValue(f, decodeValue(f, stored)) || '—' : String(stored ?? '—');
}

/** Marks still waiting for a person: AI values to accept or reject, conflicts to choose. */
export function aiPending(d: CaseDetail | null): { values: [string, AiMark][]; conflicts: [string, AiMark][] } {
  const all = Object.entries(d?.ai ?? {});
  return { values: all.filter(([, m]) => m.source === 'AI' && m.field !== '*'), conflicts: all.filter(([, m]) => m.source === 'AI_CONFLICT') };
}

export function AiSheet({ ed, procs, onClose }: { ed: CaseEditor; procs: { id: string; title: string }[]; onClose: () => void }) {
  const { toast } = useStore();
  const d = ed.detail!;
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [target, setTarget] = useState<string>(procs.length === 1 ? procs[0].id : procs.length ? '' : 'new');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RunResult | null>(null);

  useEffect(() => {
    api<AiStatus>('GET', '/api/ai/status')
      .then(setStatus)
      .catch((e) => setStatusError((e as Error).message));
  }, []);

  const where = (m: AiMark): string => {
    if (m.entity === 'EP_PROCEDURES') return procs.find((p) => p.id === m.record_id)?.title ?? 'Procedure';
    const row = ed.rows(m.entity).find((r) => r._id === m.record_id);
    const pid = (row?.procedure_id as string | undefined) ?? m.procedure_id;
    const proc = pid ? procs.find((p) => p.id === pid)?.title : null;
    return [proc, dict.entities[m.entity]?.label].filter(Boolean).join(' · ');
  };

  const useSample = async (id: string) => {
    if (!id) return;
    try {
      const s = await api<{ text: string; mrn: string }>('GET', `/api/ai/sample/${id}`);
      // The sample's made-up MRN becomes this case's MRN, so the "wrong patient" check lets it through.
      setNote(s.text.split(s.mrn).join(d.meta.mrn));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const extract = async () => {
    setBusy(true);
    setError(null);
    try {
      await ed.flush();
      const r = await api<RunResult>('POST', `/api/cases/${d.meta.case_id}/ai/extract`, { note, procedure_id: target || null });
      ed.replace(r.case);
      setRun(r);
      setNote('');
      if (target === 'new' && r.procedure_id) setTarget(r.procedure_id);
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const review = async (body: object, message: string) => {
    setBusy(true);
    try {
      await ed.flush();
      const r = await api<{ done: number; case: CaseDetail }>('POST', `/api/cases/${d.meta.case_id}/ai/review`, body);
      ed.replace(r.case);
      if (message) toast({ message, kind: 'success' });
    } catch (e) {
      toast({ message: (e as Error).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const { values, conflicts } = aiPending(d);
  const ready = status?.configured && !ed.readOnly;
  const procedureFieldsSkipped = run?.items.some((i) => i.status === 'DROPPED' && i.reason?.startsWith('procedure field'));

  return (
    <Sheet title="AI Assistant" onClose={onClose} onDone={onClose} testId="ai-sheet">
      <p className="muted small">
        Paste a clinical note about this patient. The AI fills only empty fields of this case and marks them “AI” until you accept them. Names and identifiers are removed before the note is sent; the
        note is not kept.
      </p>
      {statusError && <p className="field-error">{statusError}</p>}
      {status && (
        <p className="small" data-testid="ai-provider">
          Provider: <b>{status.label}</b>
          {status.model ? ` · ${status.model}` : ''}
          {!status.configured && status.reason ? <span className="field-error"> — {status.reason}</span> : null}
        </p>
      )}

      {ready && (
        <>
          <div className="group">
            <div className="frow stack">
              <span className="lab">This note describes</span>
              <select className="ios-value" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="This note describes" data-testid="ai-target">
                {procs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
                <option value="new">A new procedure</option>
                <option value="">No procedure (patient and history only)</option>
              </select>
            </div>
            {status.sample_notes.length > 0 && (
              <div className="frow stack">
                <span className="lab">Test AI: use a sample note (made-up patients)</span>
                <select className="ios-value" value="" onChange={(e) => useSample(e.target.value)} aria-label="Use a sample note" data-testid="ai-sample">
                  <option value="">Choose a sample note…</option>
                  {status.sample_notes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id} · {s.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="frow stack">
              <span className="lab">Clinical note</span>
              <textarea className="ios-text box" rows={8} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Clinical note" data-testid="ai-note" />
              <span className="muted small">
                {note.length.toLocaleString()} / {status.max_note_chars.toLocaleString()} characters
              </span>
            </div>
          </div>
          {error && (
            <p className="field-error" role="alert" data-testid="ai-error">
              {error}
            </p>
          )}
          <button className="btn primary block" disabled={busy || !note.trim() || note.length > status.max_note_chars} onClick={extract} data-testid="ai-extract">
            {busy ? 'Working…' : 'Extract and fill'}
          </button>
        </>
      )}

      {run && (
        <div className="banner info" data-testid="ai-run">
          <span className="grow">
            {run.recognised ? '' : 'Test AI knows only its sample notes; nothing was found in this one. '}
            {run.summary.filled} filled · {run.summary.conflicts} conflict{run.summary.conflicts === 1 ? '' : 's'} · {run.summary.same} already the same · {run.summary.additional} additional ·{' '}
            {run.summary.dropped} skipped
            {procedureFieldsSkipped ? ' (procedure fields: choose the procedure this note describes)' : ''}
          </span>
        </div>
      )}

      {(values.length > 0 || conflicts.length > 0) && (
        <>
          <h3 className="sechead">To review</h3>
          {values.length > 0 && !ed.readOnly && (
            <button className="btn block" disabled={busy} onClick={() => review({ accept_all: true }, `${values.length} AI value${values.length === 1 ? '' : 's'} accepted`)} data-testid="ai-accept-all">
              Accept all {values.length} AI value{values.length === 1 ? '' : 's'}
            </button>
          )}
          <div className="group" data-testid="ai-review">
            {conflicts.map(([key, m]) => (
              <div key={key} className="grow-row ai-item" data-testid="ai-conflict">
                <span className="grow">
                  <span className="line1">
                    {fieldLabel(m.entity, m.field)} <span className="ai-tag conflict">Conflict</span>
                  </span>
                  <span className="sub">
                    {where(m)} · saved: {show(m.entity, m.field, m.record_id ? ed.rows(m.entity).find((r) => r._id === m.record_id)?.[m.field] : null)}
                  </span>
                  {(m.proposed ?? []).map((v, i) => (
                    <span key={i} className="sub ai-quote">
                      Note: “{m.evidences?.[i] ?? ''}”
                    </span>
                  ))}
                </span>
                {!ed.readOnly && (
                  <span className="ai-actions">
                    {(m.proposed ?? []).map((v, i) => (
                      <button key={i} className="btn small" disabled={busy} onClick={() => review({ actions: [{ key, action: 'use', choice: i }] }, '')}>
                        Use {show(m.entity, m.field, v)}
                      </button>
                    ))}
                    <button className="btn small" disabled={busy} onClick={() => review({ actions: [{ key, action: 'keep' }] }, '')}>
                      Keep saved
                    </button>
                  </span>
                )}
              </div>
            ))}
            {values.map(([key, m]) => (
              <div key={key} className="grow-row ai-item" data-testid="ai-value">
                <span className="grow">
                  <span className="line1">
                    {fieldLabel(m.entity, m.field)}: <b>{show(m.entity, m.field, ed.rows(m.entity).find((r) => r._id === m.record_id)?.[m.field])}</b>
                  </span>
                  <span className="sub">{where(m)}</span>
                  {m.evidence && <span className="sub ai-quote">Note: “{m.evidence}”</span>}
                </span>
                {!ed.readOnly && (
                  <span className="ai-actions">
                    <button className="btn small" disabled={busy} onClick={() => review({ actions: [{ key, action: 'accept' }] }, '')} aria-label={`Accept ${fieldLabel(m.entity, m.field)}`}>
                      Accept
                    </button>
                    <button className="btn small danger-text" disabled={busy} onClick={() => review({ actions: [{ key, action: 'reject' }] }, '')} aria-label={`Reject ${fieldLabel(m.entity, m.field)}`}>
                      Reject
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {run && run.items.some((i) => i.status === 'DROPPED') && (
        <details className="ai-dropped">
          <summary className="muted small">Skipped ({run.items.filter((i) => i.status === 'DROPPED').length})</summary>
          <div className="group">
            {run.items
              .filter((i) => i.status === 'DROPPED')
              .map((i, n) => (
                <div key={n} className="grow-row small">
                  <span className="grow">
                    {fieldLabel(i.entity, i.field)}: <span className="muted">{i.reason}</span>
                  </span>
                </div>
              ))}
          </div>
        </details>
      )}
    </Sheet>
  );
}
