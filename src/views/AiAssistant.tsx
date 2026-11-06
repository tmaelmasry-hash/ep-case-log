// AI Assistant (phase 11): paste a clinical note, read and edit what will be sent (identifiers removed, best effort),
// then the AI fills empty fields of this case (marked "AI" until a person accepts them) and lists conflicts with saved
// values for a person to choose. The note is sent once and never kept.
import { useEffect, useState } from 'react';
import { displayValue, hasValue } from '../../shared/dictionary.ts';
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
}

interface Removed {
  mrn: number;
  id: number;
  email: number;
  phone: number;
  name: number;
  instruction: number;
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
  removed: Removed;
  procedure_id: string | null;
  case: CaseDetail;
}

const countOf = (n: number, one: string, many = `${one}s`) => (n ? [`${n} ${n === 1 ? one : many}`] : []);
/** "4 names · 1 ID number · 1 MRN", or null if nothing was removed. */
function removedText(r: Removed): string | null {
  const parts = [...countOf(r.name, 'name'), ...countOf(r.id, 'ID number'), ...countOf(r.mrn, 'MRN'), ...countOf(r.phone, 'phone number'), ...countOf(r.email, 'email'), ...countOf(r.instruction, 'instruction to the AI', 'instructions to the AI')];
  return parts.length ? parts.join(' · ') : null;
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
  // Step 2, "This is what will be sent": null while the person is still on the note. Going back keeps the note.
  const [preview, setPreview] = useState<{ text: string; removed: Removed } | null>(null);
  const [sendText, setSendText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RunResult | null>(null);
  // The note goes to the case's latest procedure, or a new one if there is none (owner, 4 Nov: no choice to make here).
  // The AI values stay marked and show their procedure until a person accepts them.
  const latest = [...ed.rows('EP_PROCEDURES')].sort((a, b) => String(a.procedure_start_datetime ?? '').localeCompare(String(b.procedure_start_datetime ?? ''))).pop();
  const target = latest?._id ?? 'new';
  const targetTitle = procs.length > 1 ? procs.find((p) => p.id === target)?.title : null;

  useEffect(() => {
    api<AiStatus>('GET', '/api/ai/status')
      .then(setStatus)
      .catch((e) => setStatusError((e as Error).message));
  }, []);

  const where = (m: AiMark): string => {
    if (m.entity === 'EP_PROCEDURES') return procs.find((p) => p.id === m.record_id)?.title ?? 'Procedure';
    const row = ed.rows(m.entity).find((r) => r._id === m.record_id);
    // A device check or a lead's measurements: say which device (and lead) the value went to.
    const check = m.entity === 'DEVICE_CHECK_CHANNELS' ? ed.rows('DEVICE_INTERROGATIONS').find((r) => r._id === row?.device_check_id) : m.entity === 'DEVICE_INTERROGATIONS' ? row : undefined;
    if (check) {
      const device = ed.rows('DEVICES').find((r) => r._id === check.device_id);
      const lead = m.entity === 'DEVICE_CHECK_CHANNELS' ? ed.rows('DEVICE_LEADS').find((r) => r._id === row?.lead_id) : undefined;
      const name = device && ['manufacturer', 'current_device_type'].filter((f) => device[f]).map((f) => show('DEVICES', f, device[f])).join(' ');
      return [name || 'Device', dict.entities[m.entity].label, lead?.lead_location ? show('DEVICE_LEADS', 'lead_location', lead.lead_location) : null].filter(Boolean).join(' · ');
    }
    const pid = (row?.procedure_id as string | undefined) ?? m.procedure_id;
    const proc = pid ? procs.find((p) => p.id === pid)?.title : null;
    return [proc, dict.entities[m.entity]?.label].filter(Boolean).join(' · ');
  };

  const showPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await api<{ text: string; removed: Removed }>('POST', `/api/cases/${d.meta.case_id}/ai/preview`, { note });
      setPreview(p);
      setSendText(p.text);
      setRun(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const backToNote = () => {
    setPreview(null);
    setError(null);
  };

  const extract = async () => {
    setBusy(true);
    setError(null);
    try {
      await ed.flush();
      const r = await api<RunResult>('POST', `/api/cases/${d.meta.case_id}/ai/extract`, { note, sent_text: sendText, procedure_id: target });
      ed.replace(r.case);
      setRun(r);
      setNote('');
      setPreview(null);
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
  // Rows the AI added whose required date the note did not state: a person gives the date; it is never guessed (owner, 4 Nov).
  const undated = Object.values(d.ai ?? {}).flatMap((m) => {
    if (m.source !== 'AI' || m.field !== '*') return [];
    const field = dict.entities[m.entity]?.fields.find((f) => f.type === 'date' && f.req === 'R');
    const row = ed.rows(m.entity).find((r) => r._id === m.record_id);
    return field && row && !hasValue(row[field.name]) ? [{ mark: m, field, quote: values.find(([, v]) => v.entity === m.entity && v.record_id === m.record_id)?.[1].evidence }] : [];
  });
  const waitsForDate = (m: AiMark) => undated.some((u) => u.mark.entity === m.entity && u.mark.record_id === m.record_id);
  const acceptable = values.filter(([, m]) => !waitsForDate(m));
  const ready = status?.configured && !ed.readOnly;
  const removedNow = preview && removedText(preview.removed);
  const removedAgain = run && removedText(run.removed);

  return (
    <Sheet title="AI Assistant" onClose={onClose} onDone={onClose} testId="ai-sheet">
      {!preview && <p className="muted small">Paste a clinical note about this patient. The AI fills only empty fields of this case and marks them “AI” until you accept them. The note is not kept.</p>}
      {statusError && <p className="field-error">{statusError}</p>}
      {status && (
        <p className="small" data-testid="ai-provider">
          Provider: <b>{status.label}</b>
          {status.model ? ` · ${status.model}` : ''}
          {!status.configured && status.reason ? <span className="field-error"> — {status.reason}</span> : null}
        </p>
      )}

      {ready && preview && (
        <>
          <h3 className="sechead">This is what will be sent</h3>
          <p className="small" data-testid="ai-removed">
            {removedNow ? `Removed: ${removedNow}` : 'Nothing was found to remove.'}
          </p>
          <div className="banner info ai-check-note">
            <span className="grow small">Removal is automatic and can miss things. Read the text below and delete anything that could identify a person before you send it.</span>
          </div>
          <div className="group">
            <div className="frow stack">
              <span className="lab">Text to send (you can edit it)</span>
              <textarea className="ios-text box" rows={11} dir="auto" value={sendText} onChange={(e) => setSendText(e.target.value)} aria-label="Text to send" data-testid="ai-sent-text" />
              {targetTitle && (
                <span className="muted small" data-testid="ai-target-line">
                  Procedure details go to: {targetTitle}
                </span>
              )}
            </div>
          </div>
          {error && (
            <p className="field-error" role="alert" data-testid="ai-error">
              {error}
            </p>
          )}
          <div className="ai-send-row">
            <button className="btn" disabled={busy} onClick={backToNote} data-testid="ai-back">
              Back to the note
            </button>
            <button className="btn primary" disabled={busy || !sendText.trim() || sendText.length > status.max_note_chars} onClick={extract} data-testid="ai-send">
              {busy ? 'Working…' : 'Send and fill'}
            </button>
          </div>
        </>
      )}

      {ready && !preview && (
        <>
          <div className="group">
            <div className="frow stack">
              <span className="lab">Clinical note</span>
              <textarea className="ios-text box" rows={8} dir="auto" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Clinical note" data-testid="ai-note" />
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
          <button className="btn primary block" disabled={busy || !note.trim() || note.length > status.max_note_chars} onClick={showPreview} data-testid="ai-preview">
            {busy ? 'Working…' : 'Review what will be sent'}
          </button>
        </>
      )}

      {run && !preview && (
        <div className="banner info" data-testid="ai-run">
          <span className="grow">
            {run.recognised ? '' : 'Test AI knows only its sample notes; nothing was found in this one. '}
            {run.summary.filled} filled · {run.summary.conflicts} conflict{run.summary.conflicts === 1 ? '' : 's'} · {run.summary.same} already the same · {run.summary.additional} additional ·{' '}
            {run.summary.dropped} skipped
            {removedAgain ? `. Also removed from your edits before sending: ${removedAgain}` : ''}
          </span>
        </div>
      )}

      {!preview && (values.length > 0 || conflicts.length > 0 || undated.length > 0) && (
        <>
          <h3 className="sechead">To review</h3>
          {acceptable.length > 0 && !ed.readOnly && (
            <button
              className="btn block"
              disabled={busy}
              onClick={() => review(undated.length ? { actions: acceptable.map(([key]) => ({ key, action: 'accept' })) } : { accept_all: true }, `${acceptable.length} AI value${acceptable.length === 1 ? '' : 's'} accepted`)}
              data-testid="ai-accept-all"
            >
              Accept all {acceptable.length} AI value{acceptable.length === 1 ? '' : 's'}
            </button>
          )}
          <div className="group" data-testid="ai-review">
            {undated.map((u) => (
              <div key={`${u.mark.entity}|${u.mark.record_id}`} className="frow stack" data-testid="ai-date-missing">
                <span className="lab">
                  {where(u.mark)} <span className="ai-tag conflict">Date missing</span>
                </span>
                {u.quote && <span className="sub ai-quote">Note: “{u.quote}”</span>}
                <input
                  className="ios-value"
                  type="date"
                  disabled={ed.readOnly}
                  aria-label={`${u.field.label} for ${where(u.mark)}`}
                  value=""
                  onChange={(e) => e.target.value && ed.setField(u.mark.entity, u.mark.record_id, u.field.name, e.target.value)}
                />
                <span className="muted small">The note gives no date for this. Enter it to accept these values.</span>
              </div>
            ))}
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
                    <button className="btn small" disabled={busy || waitsForDate(m)} onClick={() => review({ actions: [{ key, action: 'accept' }] }, '')} aria-label={`Accept ${fieldLabel(m.entity, m.field)}`}>
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

      {run && !preview && run.items.some((i) => i.status === 'DROPPED') && (
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
