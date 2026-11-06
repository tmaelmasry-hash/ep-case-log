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
import { Icon } from '../components/Icon';
import { plainWaiting, type AiPending, type AiServerItem, type PendingItem } from '../lib/aiPending';
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

interface RunResult {
  provider: string;
  recognised: boolean;
  summary: { filled: number; same: number; conflicts: number; dropped: number; additional: number };
  items: AiServerItem[];
  removed: Removed;
  target: string | null;
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

/** Opened from one section: only its fields are read from the note. Without it (the AI button at the top), all sections. */
export interface AiScope {
  section: string;
  title: string;
  procedureId?: string;
}

/** The first line of a case section: opens the AI Assistant for this section. */
export function AiLine({ onClick }: { onClick: () => void }) {
  return (
    <button className="ai-line" onClick={onClick} data-testid="ai-line">
      <Icon name="sparkle" size={20} />
      <span className="grow">Fill From a Note</span>
      <span className="muted small">AI</span>
    </button>
  );
}

/** A person's own value in place of the proposed one. Lists of several codes are changed in the section itself, after accepting. */
function EditValue({ entity, field, value, onDone, onCancel }: { entity: string; field: string; value: unknown; onDone: (v: unknown) => void; onCancel: () => void }) {
  const f = fieldOf(entity, field);
  const [text, setText] = useState(String(value ?? ''));
  const label = `Edit ${fieldLabel(entity, field)}`;
  const props = { className: 'ios-value ai-edit', 'aria-label': label, value: text, 'data-testid': 'ai-edit-input' };
  let input;
  if (f?.codes?.length) {
    input = (
      <select {...props} onChange={(e) => setText(e.target.value)}>
        {f.codes.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label}
          </option>
        ))}
      </select>
    );
  } else if (f?.type === 'boolean') {
    input = (
      <select {...props} onChange={(e) => setText(e.target.value)}>
        <option value="1">Yes</option>
        <option value="0">No</option>
      </select>
    );
  } else {
    input = <input {...props} type={f?.type === 'date' || f?.type === 'datetime' ? 'date' : f?.type === 'integer' || f?.type === 'decimal' ? 'number' : 'text'} onChange={(e) => setText(e.target.value)} />;
  }
  return (
    <>
      {input}
      <span className="ai-actions">
        <button className="btn small primary" disabled={!text.trim()} onClick={() => onDone(text)} data-testid="ai-edit-accept">
          Accept Edit
        </button>
        <button className="btn small" onClick={onCancel}>
          Cancel
        </button>
      </span>
    </>
  );
}

/** Values waiting on this device: nothing here is in the case until it is accepted. */
function PendingList({ ed, procs, pending }: { ed: CaseEditor; procs: { id: string; title: string }[]; pending: AiPending }) {
  const [editing, setEditing] = useState<string | null>(null);
  const items = pending.items;
  const dateFieldOf = (entity: string) => (dict.entities[entity]?.cardinality === 'multi' ? dict.entities[entity].fields.find((f) => f.type === 'date' && f.req === 'R') : undefined);
  // Rows the note gives no date for: a person gives the date before their values can be accepted; it is never guessed.
  const seen = new Set<string>();
  const undated = items.flatMap((i) => {
    const field = i.kind === 'value' && i.st !== 'no' ? dateFieldOf(i.entity) : undefined;
    const id = `${i.run}|${i.entity}|${i.row}`;
    if (!field || seen.has(id)) return [];
    seen.add(id);
    const dated = items.some((x) => x.run === i.run && x.entity === i.entity && x.row === i.row && x.field === field.name && x.st !== 'no');
    const rowId = pending.rowIdOf(i.run, i.entity, i.row);
    if (dated || (rowId && hasValue(ed.rows(i.entity).find((r) => r._id === rowId)?.[field.name]))) return [];
    return [{ id, item: i, field }];
  });
  const needsDate = (i: PendingItem) => undated.some((u) => u.id === `${i.run}|${i.entity}|${i.row}`);
  const all = pending.waiting.filter((i) => plainWaiting(i) && !needsDate(i));

  const device = (run: string) => {
    const got = ['manufacturer', 'current_device_type'].map((f) => items.find((x) => x.run === run && x.entity === 'DEVICES' && x.field === f && x.st !== 'no')?.value ?? ed.rows('DEVICES')[0]?.[f]);
    return ['manufacturer', 'current_device_type'].flatMap((f, n) => (got[n] ? [show('DEVICES', f, got[n])] : [])).join(' ') || 'Device';
  };
  const group = (i: PendingItem): string => {
    if (i.kind === 'additional') return 'Additional Information';
    const def = dict.entities[i.entity];
    if (i.entity === 'EP_PROCEDURES' || def?.scope === 'procedure') return procs.find((p) => p.id === pending.targetOf(i.run))?.title ?? 'New Procedure';
    const row = dict.layout.groups.flatMap((g) => g.rows).find((r) => r.entities.includes(i.entity));
    return row ? (row.title ?? row.label) : (def?.label ?? i.entity);
  };
  const place = (i: PendingItem) => (i.entity === 'DEVICE_INTERROGATIONS' || i.entity === 'DEVICE_CHECK_CHANNELS' ? `${device(i.run)} · ${dict.entities[i.entity].label}` : (dict.entities[i.entity]?.label ?? ''));
  const name = (i: PendingItem) => (i.kind === 'additional' ? 'Additional Information' : fieldLabel(i.entity, i.field));
  const text = (i: PendingItem, v: unknown) => (i.kind === 'additional' ? String(v) : show(i.entity, i.field, v));

  const groups = [...new Set(items.map(group))];
  if (!items.length) return null;
  const line = { idle: 'Nothing is saved until you accept it.', waiting: 'Saving when you stop…', saving: 'Saving…', saved: `Saved ${pending.savedCount} value${pending.savedCount === 1 ? '' : 's'}.`, failed: 'Not saved yet. It will be sent when the connection is back.' }[pending.saving];

  return (
    <>
      <h3 className="sechead">To Review</h3>
      <p className="muted small" role="status" data-testid="ai-save">
        {line}
      </p>
      {!ed.readOnly && (
        <button className="btn block" disabled={!all.length} onClick={() => pending.accept(all.map((i) => i.id))} data-testid="ai-accept-all">
          {all.length ? `Accept All ${all.length}` : 'Nothing Left for Accept All'}
        </button>
      )}
      {groups.map((g) => (
        <div key={g}>
          <h3 className="sechead">{g}</h3>
          <div className="group" data-testid="ai-review">
            {undated
              .filter((u) => group(u.item) === g)
              .map((u) => (
                <div key={u.id} className="frow stack" data-testid="ai-date-missing">
                  <span className="lab">
                    {place(u.item)} <span className="ai-tag conflict">Date missing</span>
                  </span>
                  {u.item.evidence && <span className="sub ai-quote">Note: “{u.item.evidence}”</span>}
                  <input className="ios-value" type="date" aria-label={`${u.field.label} for ${place(u.item)}`} value="" onChange={(e) => e.target.value && pending.addDate(u.item.run, u.item.entity, u.field.name, u.item.row, e.target.value)} />
                  <span className="muted small">The note gives no date for this. Enter it to accept these values.</span>
                </div>
              ))}
            {items
              .filter((i) => group(i) === g)
              .map((i) => {
                if (i.st !== 'wait') {
                  const end = i.st === 'keep' ? 'saved value kept' : i.st === 'no' ? 'rejected' : text(i, i.value);
                  const good = i.st === 'ok' || i.st === 'sent';
                  return (
                    <div key={i.id} className={`grow-row ai-item ${good ? 'ai-good' : 'ai-gone'}`} data-testid={good ? 'ai-accepted' : 'ai-rejected'}>
                      <span className="grow">
                        {good ? '✓ ' : ''}
                        {name(i)}: {end}
                      </span>
                      {i.st !== 'sent' && !ed.readOnly && (
                        <button className="link" onClick={() => pending.undo(i.id)}>
                          Undo
                        </button>
                      )}
                    </div>
                  );
                }
                return (
                  <div key={i.id} className="grow-row ai-item stacked" data-testid={i.kind === 'conflict' ? 'ai-conflict' : 'ai-value'}>
                    <span className="line1">
                      {name(i)}
                      {i.kind !== 'conflict' && (
                        <>
                          : <b>{text(i, i.value)}</b>
                        </>
                      )}
                      {i.kind === 'conflict' && <span className="ai-tag conflict">Differs</span>}
                      {i.flag && <span className="ai-tag conflict" data-testid="ai-flag">Procedure cancelled: check</span>}
                    </span>
                    {i.kind === 'conflict' ? <span className="sub">{place(i)} · Saved now: {i.saved === null || i.saved === undefined ? '—' : text(i, i.saved)}</span> : <span className="sub">{place(i)} · Now empty</span>}
                    {(i.kind === 'conflict' ? (i.evidences ?? []) : i.evidence ? [i.evidence] : []).map((q, n) => (
                      <span key={n} className="sub ai-quote">
                        Note: “{q}”
                      </span>
                    ))}
                    {i.error && <span className="field-error">{i.error}</span>}
                    {!ed.readOnly && editing === i.id && (
                      <EditValue
                        entity={i.entity}
                        field={i.field}
                        value={i.value}
                        onCancel={() => setEditing(null)}
                        onDone={(v) => {
                          setEditing(null);
                          pending.acceptEdited(i.id, v);
                        }}
                      />
                    )}
                    {!ed.readOnly && editing !== i.id && (
                      <span className="ai-actions">
                        {i.kind === 'conflict' ? (
                          <>
                            {(i.proposed ?? []).map((v, n) => (
                              <button key={n} className="btn small" onClick={() => pending.use(i.id, v)}>
                                Use {text(i, v)}
                              </button>
                            ))}
                            <button className="btn small" onClick={() => pending.keep(i.id)}>
                              Keep Saved
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="btn small" disabled={needsDate(i)} onClick={() => pending.accept([i.id])} aria-label={`Accept ${name(i)}`}>
                              Accept
                            </button>
                            <button className="btn small danger-text" onClick={() => pending.reject(i.id)} aria-label={`Reject ${name(i)}`}>
                              Reject
                            </button>
                            {i.kind === 'value' && fieldOf(i.entity, i.field)?.type !== 'lookup_array' && (
                              <button className="btn small" disabled={needsDate(i)} onClick={() => setEditing(i.id)} aria-label={`Edit ${name(i)}`}>
                                Edit
                              </button>
                            )}
                          </>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </>
  );
}

export function AiSheet({ ed, procs, scope, note, setNote, pending, onClose }: { ed: CaseEditor; procs: { id: string; title: string }[]; scope?: AiScope; note: string; setNote: (s: string) => void; pending: AiPending; onClose: () => void }) {
  const { toast } = useStore();
  const d = ed.detail!;
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  // Step 2, "This is what will be sent": null while the person is still on the note. Going back keeps the note.
  const [preview, setPreview] = useState<{ text: string; removed: Removed } | null>(null);
  const [sendText, setSendText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RunResult | null>(null);
  // The note goes to the case's latest procedure, or a new one if there is none (owner, 4 Nov: no choice to make here).
  // The AI values stay marked and show their procedure until a person accepts them.
  const latest = [...ed.rows('EP_PROCEDURES')].sort((a, b) => String(a.procedure_start_datetime ?? '').localeCompare(String(b.procedure_start_datetime ?? ''))).pop();
  const target = scope?.procedureId ?? latest?._id ?? 'new';
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
      const r = await api<RunResult>('POST', `/api/cases/${d.meta.case_id}/ai/extract`, { note, sent_text: sendText, procedure_id: target, ...(scope ? { sections: [scope.section] } : {}) });
      pending.addRun(r.target, r.items);
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
      {scope && (
        <p className="small strong" data-testid="ai-scope">
          Only {scope.title} is filled from this note.
        </p>
      )}
      {!preview && !pending.items.length && <p className="muted small">Paste a clinical note about this patient. Nothing is saved until you accept it. The note is not kept.</p>}
      {statusError && <p className="field-error">{statusError}</p>}
      {status && (
        <p className="small" data-testid="ai-provider">
          Provider: <b>{status.label}</b>
          {status.model ? ` · ${status.model}` : ''}
          {!status.configured && status.reason ? <span className="field-error"> — {status.reason}</span> : null}
        </p>
      )}

      {run && !preview && (
        <div className="banner info" data-testid="ai-run">
          <span className="grow">
            {run.recognised ? '' : 'Test AI knows only its sample notes; nothing was found in this one. '}
            {run.summary.filled} to review · {run.summary.conflicts} differ{run.summary.conflicts === 1 ? 's' : ''} from saved · {run.summary.same} already the same · {run.summary.additional} additional · {run.summary.dropped} skipped
            {removedAgain ? `. Also removed from your edits before sending: ${removedAgain}` : ''}
          </span>
        </div>
      )}
      {!preview && <PendingList ed={ed} procs={procs} pending={pending} />}

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

      {!preview && (values.length > 0 || conflicts.length > 0 || undated.length > 0) && (
        <>
          <h3 className="sechead">Waiting From Before</h3>
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
