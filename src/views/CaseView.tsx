// Case page (approved EP Log-style preview): header card, then grouped rows; each row opens its form in a sheet.
// Case = one EP_EPISODE; PROCEDURES lists the episode's EP_PROCEDURES, each with its components and modules.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { codeLabel, displayValue, formFields, hasValue, offeredCodes, type FormField } from '../../shared/dictionary.ts';
import { ageOn, type CaseDetail, type DecodedRow, type HistoryItem } from '../../shared/caseTypes.ts';
import { NA_REASONS, evaluateReadiness, isProcedureLevel, naKey, type CoreCheck, type Issue, type Readiness, type Tally } from '../../shared/readiness.ts';
import { dict, fieldOf, label } from '../lib/dict';
import { ageSex, fmtDate, fmtShortDate } from '../lib/util';
import { useCaseEditor, type CaseEditor } from '../caseEditor';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { Icon } from '../components/Icon';
import { Confirm, Empty, SaveIndicator, Sheet } from '../components/ui';
import { EntityFields, type FkOption, type NaInfo } from '../components/Fields';
import { api, ApiError } from '../lib/api';
import { cha2ds2vasc, chaRelevant, type ChaResult } from '../../shared/cha.ts';
import { CaseReport, PrintPortal } from './CaseReport';
import { AiSheet, aiPending } from './AiAssistant';
import { CaseCohortsSheet } from '../components/CaseCohortsSheet';
import { useCohorts } from '../lib/cohorts';

// ── readiness shared by every sheet of the open case ──
interface CaseCtx {
  readiness: Readiness;
  checks: Map<string, CoreCheck>;
  askNa: (entity: string, field: string, procedureId: string | null) => void;
}
const CaseContext = createContext<CaseCtx | null>(null);
const useCase = () => useContext(CaseContext)!;

/** "Not available" for a core field of this scope: offered while empty, shown with its reason once recorded. */
function naInfo(c: CaseCtx, entity: string, field: string, procedureId: string | null): NaInfo | undefined {
  const check = c.checks.get(naKey(entity, field, procedureId));
  if (!check || !check.na_allowed) return undefined;
  if (check.state === 'missing') return { state: 'missing' };
  if (check.state === 'not_available') return { state: 'not_available', reason: check.reason };
  return undefined;
}

function scopeOf(entity: string, rowId: string, parentId: string | null | undefined, row: DecodedRow | null): string | null {
  if (entity === 'EP_PROCEDURES') return rowId;
  if (dict.entities[entity].scope === 'procedure') return (parentId ?? (row?.procedure_id as string)) || null;
  return null;
}

// ── helpers ──
function firstDate(entity: string, row: DecodedRow): string | null {
  const f = dict.entities[entity].fields.find((x) => (x.type === 'date' || x.type === 'datetime') && hasValue(row[x.name]));
  return f ? String(row[f.name]) : null;
}

function firstCode(entity: string, row: DecodedRow): string | null {
  const f = dict.entities[entity].fields.find((x) => x.codes && !x.auto && x.type !== 'boolean_unknown' && hasValue(row[x.name]) && !Array.isArray(row[x.name]));
  return f ? codeLabel(f, row[f.name]) : null;
}

export function rowTitle(entity: string, row: DecodedRow, i: number): string {
  const def = dict.entities[entity];
  const code = firstCode(entity, row);
  const date = firstDate(entity, row);
  return [`${def.label} ${i + 1}`, code, date ? fmtShortDate(date) : null].filter(Boolean).join(' · ');
}

function procedureTitle(p: DecodedRow, i: number): string {
  return `Procedure ${i + 1}${p.primary_procedure_type ? ` · ${label('EP_PROCEDURES', 'primary_procedure_type', String(p.primary_procedure_type))}` : ''}`;
}

function filledCount(entity: string, row: DecodedRow | undefined): number {
  if (!row) return 0;
  return dict.entities[entity].fields.filter((f) => !f.auto && f.type !== 'json_object' && hasValue(row[f.name])).length;
}

function useFk(ed: CaseEditor) {
  return (f: FormField): FkOption[] => {
    if (f.target === 'USERS') return (ed.detail?.users ?? []).map((u) => ({ value: u.id, label: u.name }));
    if (!f.target || !dict.entities[f.target]) return [];
    if (f.target === 'EP_PROCEDURES') return ed.rows('EP_PROCEDURES').map((p, i) => ({ value: p._id, label: procedureTitle(p, i) }));
    if (f.target === 'EP_EPISODES') return ed.rows('EP_EPISODES').map((e) => ({ value: e._id, label: 'This episode' }));
    return ed.rows(f.target).map((r, i) => ({ value: r._id, label: rowTitle(f.target!, r, i) }));
  };
}

/** One row of an entity as a form; creates the row on the first edit when it does not exist yet. */
function RowForm({ ed, entity, rowId, parentId, row, only }: { ed: CaseEditor; entity: string; rowId: string; parentId?: string | null; row: DecodedRow | null; only?: string[] }) {
  const fk = useFk(ed);
  const c = useCase();
  const exists = !!row;
  const pid = scopeOf(entity, rowId, parentId, row);
  return (
    <EntityFields
      entity={entity}
      row={row}
      rowId={rowId}
      fkOptions={fk}
      readOnly={ed.readOnly}
      errorOf={(field) => ed.fieldError(entity, rowId, field)}
      naOf={(field) => naInfo(c, entity, field, pid)}
      onNa={(field) => c.askNa(entity, field, pid)}
      copiedOf={(field) => ed.detail?.copied?.[`${entity}.${field}`]}
      aiOf={(field) => ed.detail?.ai?.[`${entity}|${rowId}|${field}`] ?? ed.detail?.ai?.[`${entity}|${rowId}|${field}#ai`]}
      only={only}
      onChange={(field, value, key) => ed.setField(entity, rowId, field, value, { key, create: exists ? undefined : { parent_id: parentId ?? null } })}
    />
  );
}

/** Core fields of a repeatable section that has no row yet (e.g. LVEF when no echo was added): "Not available" here. */
function CoreWithoutRows({ entity }: { entity: string }) {
  const c = useCase();
  const list = c.readiness.checks.filter((x) => x.entity === entity && x.procedure_id === null && x.na_allowed && (x.state === 'missing' || x.state === 'not_available'));
  if (!list.length) return null;
  return (
    <div className="group core-norows">
      {list.map((x) => {
        const info = naInfo(c, x.entity, x.field, null)!;
        return (
          <div key={x.key} className="frow stack" data-field={`${x.entity}.${x.field}`}>
            <span className="lab">
              {x.label}
              <span className="req" title="Core field">
                {' '}
                *
              </span>
            </span>
            <span className="hint">No {dict.entities[entity].label.toLowerCase()} added yet. Add one, or record why it is not available.</span>
            <span className="na-line">
              {info.state === 'not_available' && (
                <span className="na-tag" data-testid="na-tag">
                  Not available · {info.reason}
                </span>
              )}
              <button type="button" className="link small" onClick={() => c.askNa(x.entity, x.field, null)}>
                {info.state === 'not_available' ? 'Change' : 'Not available…'}
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Rows nested inside a parent row (e.g. device checks under the device). */
function NestedLists({ ed, parentEntity, parentId, onOpen }: { ed: CaseEditor; parentEntity: string; parentId: string; onOpen: (entity: string, id: string) => void }) {
  const children = Object.values(dict.entities).filter((d) => d.nest_under?.entity === parentEntity);
  if (!children.length) return null;
  return (
    <>
      {children.map((child) => {
        const kids = ed.rows(child.entity).filter((k) => k[child.nest_under!.fk] === parentId);
        return (
          <div key={child.entity}>
            <h3 className="sechead">{child.label}</h3>
            <div className="group">
              {kids.map((k, i) => (
                <button key={k._id} className="grow-row" onClick={() => onOpen(child.entity, k._id)}>
                  <span className="grow">{rowTitle(child.entity, k, i)}</span>
                  <Icon name="chevron" size={16} className="muted" />
                </button>
              ))}
              {!ed.readOnly && (
                <button className="grow-row add" onClick={() => onOpen(child.entity, ed.addRow(child.entity, parentId))}>
                  <Icon name="plus" size={18} /> Add {child.label.toLowerCase()}
                </button>
              )}
              {ed.readOnly && !kids.length && <div className="grow-row muted">None</div>}
            </div>
          </div>
        );
      })}
    </>
  );
}

/** A repeatable row opened on its own: its fields, its nested rows, and Remove. */
function RowSheet({ ed, entity, id, onClose }: { ed: CaseEditor; entity: string; id: string; onClose: () => void }) {
  const def = dict.entities[entity];
  const all = def.nest_under ? ed.rows(entity).filter((r) => r[def.nest_under!.fk] === ed.rows(entity).find((x) => x._id === id)?.[def.nest_under!.fk]) : ed.rows(entity);
  const i = all.findIndex((r) => r._id === id);
  const row = all[i] ?? null;
  const [confirm, setConfirm] = useState(false);
  const [child, setChild] = useState<{ entity: string; id: string } | null>(null);
  if (child) return <RowSheet ed={ed} entity={child.entity} id={child.id} onClose={() => setChild(null)} />;
  return (
    <Sheet title={row ? rowTitle(entity, row, i) : def.label} onClose={onClose} onDone={onClose} testId="row-sheet">
      {!row ? (
        <p className="muted">This row was removed.</p>
      ) : (
        <>
          <RowForm ed={ed} entity={entity} rowId={id} row={row} />
          <NestedLists ed={ed} parentEntity={entity} parentId={id} onOpen={(e, cid) => setChild({ entity: e, id: cid })} />
          {!ed.readOnly && (
            <button className="btn danger-text block" onClick={() => setConfirm(true)}>
              <Icon name="trash" size={18} /> Remove {def.label.toLowerCase()}
            </button>
          )}
        </>
      )}
      {confirm && (
        <Confirm
          title={`Remove ${def.label.toLowerCase()}?`}
          message="Its values (and any rows inside it) will be removed from this case."
          confirmLabel="Remove"
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            ed.removeRow(entity, id);
            onClose();
          }}
        />
      )}
    </Sheet>
  );
}

/** A layout row (e.g. "Patient", "ECG", "Devices"): one-per-case sections as forms, repeatable ones as lists. */
function SectionSheet({ ed, title, entities, focus, onClose }: { ed: CaseEditor; title: string; entities: string[]; focus?: string; onClose: () => void }) {
  const [open, setOpen] = useState<{ entity: string; id: string } | null>(null);
  const caseId = ed.detail!.meta.case_id;
  useFocusField(focus);
  if (open) return <RowSheet ed={ed} entity={open.entity} id={open.id} onClose={() => setOpen(null)} />;
  return (
    <Sheet title={title} onClose={onClose} onDone={onClose} testId="section-sheet">
      {entities.map((entity) => {
        const def = dict.entities[entity];
        if (def.cardinality === 'single') {
          const id = entity === 'PATIENTS' || entity === 'PATIENT_IDENTIFIERS' ? ed.detail!.meta.patient_id : entity === 'EP_EPISODES' ? ed.detail!.meta.episode_id : ed.slot(entity, caseId);
          const row = ed.rows(entity).find((r) => r._id === id) ?? null;
          return (
            <div key={entity}>
              {entities.length > 1 && <h3 className="sechead">{def.label}</h3>}
              <RowForm ed={ed} entity={entity} rowId={id} row={row} />
              {row && <NestedLists ed={ed} parentEntity={entity} parentId={id} onOpen={(e, cid) => setOpen({ entity: e, id: cid })} />}
            </div>
          );
        }
        const rows = ed.rows(entity);
        return (
          <div key={entity}>
            <h3 className="sechead">{def.label}</h3>
            <div className="group">
              {rows.map((r, i) => (
                <button key={r._id} className="grow-row" onClick={() => setOpen({ entity, id: r._id })} data-testid="list-row">
                  <span className="grow">{rowTitle(entity, r, i)}</span>
                  <span className="muted small">{filledCount(entity, r)} filled</span>
                  <Icon name="chevron" size={16} className="muted" />
                </button>
              ))}
              {!ed.readOnly && (
                <button className="grow-row add" onClick={() => setOpen({ entity, id: ed.addRow(entity) })}>
                  <Icon name="plus" size={18} /> Add {def.label.toLowerCase()}
                </button>
              )}
              {ed.readOnly && !rows.length && <div className="grow-row muted">None</div>}
            </div>
            {!rows.length && <CoreWithoutRows entity={entity} />}
          </div>
        );
      })}
    </Sheet>
  );
}

const MODULES = Object.values(dict.entities).filter((d) => d.module);

/** One procedure: its EP_PROCEDURES fields, components, the modules they call for, and its complications. */
function ProcedureSheet({ ed, id, focus, onClose }: { ed: CaseEditor; id: string; focus?: string; onClose: () => void }) {
  const c = useCase();
  useFocusField(focus);
  const procs = ed.rows('EP_PROCEDURES');
  const i = procs.findIndex((p) => p._id === id);
  const p = procs[i];
  const [extra, setExtra] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<null | 'procedure' | { componentId: string; module: string }>(null);
  const [open, setOpen] = useState<{ entity: string; id: string } | null>(null);
  const comps = ed.rows('PROCEDURE_COMPONENTS').filter((c) => c.procedure_id === id);
  const types = comps.map((c) => String(c.component_type));
  const compField = fieldOf('PROCEDURE_COMPONENTS', 'component_type');

  if (open) return <RowSheet ed={ed} entity={open.entity} id={open.id} onClose={() => setOpen(null)} />;
  if (!p)
    return (
      <Sheet title="Procedure" onClose={onClose}>
        <p className="muted">This procedure was removed.</p>
      </Sheet>
    );

  const moduleRow = (entity: string) => ed.rows(entity).find((r) => r.procedure_id === id) ?? null;
  // A module shows for its components, when it has values, when asked for, or when this procedure's core fields need it.
  const needed = (entity: string) => c.readiness.checks.some((x) => x.procedure_id === id && x.entity === entity && x.state !== 'not_applicable');
  const shown = MODULES.filter((m) => m.module!.some((t) => types.includes(t)) || moduleRow(m.entity) || extra.includes(m.entity) || needed(m.entity));
  const offer = MODULES.filter((m) => !shown.includes(m));

  const toggleComponent = (code: string) => {
    const existing = comps.find((c) => c.component_type === code);
    if (!existing) {
      ed.addRow('PROCEDURE_COMPONENTS', id, { component_type: code });
      return;
    }
    const mod = MODULES.find((m) => m.module!.includes(code) && moduleRow(m.entity) && filledCount(m.entity, moduleRow(m.entity)!) > 2);
    if (mod) setConfirm({ componentId: existing._id, module: mod.label });
    else ed.removeRow('PROCEDURE_COMPONENTS', existing._id);
  };

  const review = ed.slot('EXT_PROCEDURE_REVIEW', id);
  const complications = ed.rows('COMPLICATIONS').filter((c) => c.procedure_id === id);

  return (
    <Sheet title={procedureTitle(p, i)} onClose={onClose} onDone={onClose} testId="procedure-sheet">
      <RowForm ed={ed} entity="EP_PROCEDURES" rowId={id} row={p} />

      <h3 className="sechead">Procedure components</h3>
      <div className="group">
        <div className="frow stack">
          <div className="pill-set" role="group" aria-label="Procedure components">
            {offeredCodes(compField, null).map((c) => (
              <button key={c} type="button" aria-pressed={types.includes(c)} className={types.includes(c) ? 'on' : ''} disabled={ed.readOnly} onClick={() => toggleComponent(c)}>
                {codeLabel(compField, c)}
              </button>
            ))}
          </div>
          {!ed.readOnly && <span className="hint">Each component opens its own section below.</span>}
        </div>
      </div>

      {shown.map((m) => {
        const row = moduleRow(m.entity);
        const rid = row?._id ?? ed.slot(m.entity, id);
        return (
          <div key={m.entity} data-testid={`module-${m.entity}`}>
            <h3 className="sechead">{m.label}</h3>
            <RowForm ed={ed} entity={m.entity} rowId={rid} parentId={id} row={row} />
            {row && <NestedLists ed={ed} parentEntity={m.entity} parentId={rid} onOpen={(e, cid) => setOpen({ entity: e, id: cid })} />}
          </div>
        );
      })}
      {offer.length > 0 && !ed.readOnly && (
        <details className="offer">
          <summary>Add details for another procedure type</summary>
          <div className="pill-set">
            {offer.map((m) => (
              <button key={m.entity} type="button" onClick={() => setExtra((x) => [...x, m.entity])}>
                {m.label}
              </button>
            ))}
          </div>
        </details>
      )}

      <h3 className="sechead">Complications</h3>
      <RowForm ed={ed} entity="EXT_PROCEDURE_REVIEW" rowId={review} parentId={id} row={ed.rows('EXT_PROCEDURE_REVIEW').find((r) => r._id === review) ?? null} />
      <div className="group" style={{ marginTop: 10 }} data-field="COMPLICATIONS.category">
        {complications.map((x, k) => (
          <button key={x._id} className="grow-row" onClick={() => setOpen({ entity: 'COMPLICATIONS', id: x._id })}>
            <span className="grow">{rowTitle('COMPLICATIONS', x, k)}</span>
            <Icon name="chevron" size={16} className="muted" />
          </button>
        ))}
        {!ed.readOnly && (
          <button className="grow-row add" onClick={() => setOpen({ entity: 'COMPLICATIONS', id: ed.addRow('COMPLICATIONS', id) })}>
            <Icon name="plus" size={18} /> Add complication
          </button>
        )}
        {ed.readOnly && !complications.length && <div className="grow-row muted">None</div>}
      </div>

      {!ed.readOnly && (
        <button className="btn danger-text block" onClick={() => setConfirm('procedure')}>
          <Icon name="trash" size={18} /> Remove this procedure
        </button>
      )}

      {confirm === 'procedure' && (
        <Confirm
          title="Remove this procedure?"
          message={`${procedureTitle(p, i)}, its components, procedure sections, complications and follow-ups will be removed from this case.`}
          confirmLabel="Remove procedure"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            ed.removeRow('EP_PROCEDURES', id);
            onClose();
          }}
        />
      )}
      {confirm && typeof confirm === 'object' && (
        <Confirm
          title="Remove this component?"
          message={`The ${confirm.module} section has values. It stays in the case; you can remove its values separately.`}
          confirmLabel="Remove component"
          danger={false}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            ed.removeRow('PROCEDURE_COMPONENTS', confirm.componentId);
            setConfirm(null);
          }}
        />
      )}
    </Sheet>
  );
}

function AdditionalSheet({ ed, onClose }: { ed: CaseEditor; onClose: () => void }) {
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const list = ed.detail?.additional ?? [];
  return (
    <Sheet title="Additional Information" onClose={onClose} onDone={onClose} testId="additional-sheet">
      <p className="muted small">Facts that have no field in the registry dictionary. They are kept apart from the dictionary fields.</p>
      <div className="group">
        {list.map((a) => (
          <div key={a.info_id} className="grow-row">
            <span className="grow">
              {a.text}
              {a.fact_date && <span className="muted small"> · {fmtDate(a.fact_date)}</span>}
            </span>
            {!ed.readOnly && (
              <button className="icon-btn small" aria-label="Remove information" onClick={() => ed.additional('remove', a.info_id)}>
                <Icon name="trash" size={16} />
              </button>
            )}
          </div>
        ))}
        {!list.length && <div className="grow-row muted">Nothing added.</div>}
      </div>
      {!ed.readOnly && (
      <>
      <div className="group" style={{ marginTop: 14 }}>
        <div className="frow stack">
          <span className="lab">New information</span>
          <textarea className="ios-text" rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-label="New information" />
        </div>
        <div className="frow inline">
          <span className="lab">Date (optional)</span>
          <input className="ios-value" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date of the information" />
        </div>
      </div>
      <button
        className="btn primary block"
        disabled={!text.trim()}
        onClick={() => {
          ed.additional('add', `info_${crypto.randomUUID()}`, text.trim(), date || null);
          setText('');
          setDate('');
        }}
      >
        Add information
      </button>
      </>
      )}
    </Sheet>
  );
}

/** After "Go": scroll the sheet to the field and mark it briefly. */
function useFocusField(focus?: string) {
  useEffect(() => {
    if (!focus) return;
    const t = window.setTimeout(() => {
      const el = document.querySelector(`.sheet [data-field="${focus}"]`) as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      el.classList.add('flash');
      window.setTimeout(() => el.classList.remove('flash'), 1600);
    }, 250);
    return () => window.clearTimeout(t);
  }, [focus]);
}

function NaDialog({ label, current, onSave, onClose }: { label: string; current: string | null; onSave: (reason: string | null) => void; onClose: () => void }) {
  const preset = current && NA_REASONS.includes(current) ? current : null;
  const [pick, setPick] = useState<string | null>(preset ?? (current ? null : NA_REASONS[0]));
  const [other, setOther] = useState(current && !preset ? current : '');
  const reason = other.trim() || pick;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={`${label}: not available`} data-testid="na-dialog">
        <h2>{label}: not available</h2>
        <div className="dialog-msg">Choose why it is not available. Entering a value later replaces this.</div>
        <div className="reason-list" role="radiogroup" aria-label="Reason">
          {NA_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={!other.trim() && pick === r}
              className={!other.trim() && pick === r ? 'on' : ''}
              onClick={() => {
                setPick(r);
                setOther('');
              }}
            >
              {r}
            </button>
          ))}
          <textarea className="ios-text box" rows={2} maxLength={200} placeholder="Or type another reason" aria-label="Another reason" value={other} onChange={(e) => setOther(e.target.value)} />
        </div>
        <div className="dialog-actions">
          {current && (
            <button className="btn" onClick={() => onSave(null)}>
              Clear
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!reason} onClick={() => reason && onSave(reason)}>
            Save "Not available"
          </button>
        </div>
      </div>
    </div>
  );
}

function ReasonDialog({ onReopen, onClose, busy }: { onReopen: (reason: string) => void; onClose: () => void; busy: boolean }) {
  const [text, setText] = useState('');
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label="Reopen this case?" data-testid="reopen-dialog">
        <h2>Reopen this case?</h2>
        <div className="dialog-msg">The case becomes editable again and its status returns to In progress. The reason is kept in the case history.</div>
        <textarea className="ios-text box" rows={3} maxLength={300} autoFocus placeholder="Reason (required)" aria-label="Reason for reopening" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!text.trim() || busy} onClick={() => onReopen(text.trim())}>
            Reopen
          </button>
        </div>
      </div>
    </div>
  );
}

function procHeading(ed: CaseEditor, pid: string): string {
  const procs = ed.rows('EP_PROCEDURES');
  const i = procs.findIndex((p) => p._id === pid);
  const types = ed
    .rows('PROCEDURE_COMPONENTS')
    .filter((c) => c.procedure_id === pid)
    .map((c) => codeLabel(fieldOf('PROCEDURE_COMPONENTS', 'component_type'), c.component_type));
  return `${i >= 0 ? procedureTitle(procs[i], i) : 'Procedure'}${types.length ? ` (${types.join(' + ')})` : ''}`;
}

const SECTION_LABEL = new Map(dict.layout.groups.flatMap((g) => g.rows.map((r) => [r.id, r.label] as const)));

function ReadySheet({ ed, onGo, onComplete, busy, onClose }: { ed: CaseEditor; onGo: (i: Issue) => void; onComplete: () => void; busy: boolean; onClose: () => void }) {
  const { readiness: r } = useCase();
  const groups = new Map<string, Issue[]>();
  for (const b of r.blockers) {
    const k = b.procedure_id ? `p:${b.procedure_id}` : `s:${b.section}`;
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a.startsWith('p:') === b.startsWith('p:') ? 0 : a.startsWith('p:') ? -1 : 1));
  const missing = r.blockers.length;
  return (
    <Sheet title="Ready to Complete?" closeLabel="Close" onClose={onClose} onDone={onClose} testId="ready-sheet">
      <div className="summary">
        <div>
          <b>{r.done}</b>of {r.total} core fields
        </div>
        <div>
          <b className={missing ? 'bad' : ''}>{missing}</b>missing
        </div>
        <div>
          <b>{r.warnings.length}</b>warning{r.warnings.length === 1 ? '' : 's'}
        </div>
      </div>
      {!missing && (
        <div className="group">
          <div className="grow-row check-item">
            <span className="ic ok">✓</span>
            <span className="grow">Every core field has a value or "Not available" with a reason.</span>
          </div>
        </div>
      )}
      {ordered.map(([k, list]) => (
        <div key={k}>
          <h3 className="sechead">{k.startsWith('p:') ? procHeading(ed, k.slice(2)) : (SECTION_LABEL.get(k.slice(2)) ?? 'Case')}</h3>
          <div className="group">
            {list.map((b) => (
              <div key={`${b.entity}.${b.field}.${b.text}`} className="grow-row check-item" data-testid="blocker">
                <span className="ic miss">!</span>
                <span className="grow">{b.text}</span>
                <button className="link small" onClick={() => onGo(b)}>
                  Go
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {r.warnings.length > 0 && (
        <>
          <h3 className="sechead">Warnings (do not block)</h3>
          <div className="group">
            {r.warnings.map((w) => (
              <div key={w.text} className="grow-row check-item">
                <span className="ic warn">i</span>
                <span className="grow">{w.text}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="note">Every core field needs a value, or "Not available" with a reason. Procedure fields are checked for each procedure.</p>
      {!ed.readOnly && (
        <button className="btn primary block" disabled={!!missing || busy || ed.pending > 0} onClick={onComplete} data-testid="mark-completed">
          {missing ? `Mark completed (${missing} missing)` : 'Mark completed'}
        </button>
      )}
    </Sheet>
  );
}

const KIND_LABEL: Record<HistoryItem['kind'], [string, string]> = {
  create: ['CREATE', 'add'],
  edit: ['EDIT', ''],
  add: ['ADD', 'add'],
  remove: ['REMOVE', 'del'],
  na: ['N/A', ''],
  complete: ['COMPLETED', 'comp'],
  reopen: ['REOPENED', 'comp'],
  delete: ['DELETED', 'del'],
  restore: ['RESTORED', 'add'],
  ai: ['AI', ''],
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

function HistorySheet({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ items: HistoryItem[] }>('GET', `/api/cases/${caseId}/history`)
      .then((r) => setItems(r.items))
      .catch((e: ApiError) => setError(e.message));
  }, [caseId]);
  return (
    <Sheet title="Case History" closeLabel="Close" onClose={onClose} onDone={onClose} testId="history-sheet">
      <div className="group">
        {error && <div className="grow-row field-error">{error}</div>}
        {!items && !error && (
          <div className="grow-row muted">
            <span className="spinner inline" /> Loading…
          </div>
        )}
        {items?.map((h, i) => (
          <div key={i} className="grow-row hist" data-testid="history-item">
            <span className="grow">
              <span className="hist-when">
                {fmtWhen(h.at)} · {h.by} <span className={`kind ${KIND_LABEL[h.kind][1]}`}>{KIND_LABEL[h.kind][0]}</span>
              </span>
              <span className="hist-what">
                {h.text}
                {h.new !== undefined && (
                  <>
                    : <span className="old">{h.old ?? '—'}</span> → {h.new}
                  </>
                )}
              </span>
            </span>
          </div>
        ))}
      </div>
      <p className="note">Every change to this case: who, when, and the value before → after. Shown only inside the case.</p>
    </Sheet>
  );
}

function CoreTally({ t }: { t?: Tally }) {
  if (!t || !t.total) return null;
  return <b className={t.done === t.total ? 'core-ok' : 'core-miss'}>core {t.done}/{t.total}</b>;
}

// ── light follow-up (phase 7, EP Workspace O7) ──

const FU = dict.entities.FOLLOW_UPS;
const OE = dict.entities.OUTCOME_EVENTS;
const QUICK = OE.quick_events!;

function followUpTitle(r: DecodedRow, i: number): string {
  const tp = r.followup_timepoint ? label('FOLLOW_UPS', 'followup_timepoint', String(r.followup_timepoint)) : `Follow-up ${i + 1}`;
  return [tp, r.actual_followup_date ? fmtDate(String(r.actual_followup_date)) : null].filter(Boolean).join(' · ');
}

/** Yes + date for the quick event types, inside one follow-up visit. */
function QuickEvents({ ed, fu }: { ed: CaseEditor; fu: DecodedRow }) {
  const [confirm, setConfirm] = useState<DecodedRow | null>(null);
  const events = ed.rows('OUTCOME_EVENTS').filter((e) => e[QUICK.fk] === fu._id);
  const typeField = fieldOf('OUTCOME_EVENTS', QUICK.type_field);
  return (
    <>
      <h3 className="sechead">Events since the last visit</h3>
      <div className="group" data-testid="quick-events">
        {QUICK.codes.map((code) => {
          const ev = events.find((e) => e[QUICK.type_field] === code);
          const name = codeLabel(typeField, code);
          return (
            <div key={code} className="frow stack" data-quick={code}>
              <span className="lab">{name}</span>
              <div className="quick-line">
                <div className="mini-seg" role="radiogroup" aria-label={name}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!!ev}
                    className={ev ? 'on' : ''}
                    disabled={ed.readOnly}
                    onClick={() => !ev && ed.addRow('OUTCOME_EVENTS', String(fu.procedure_id), { [QUICK.fk]: fu._id, [QUICK.type_field]: code })}
                  >
                    Yes
                  </button>
                  <button type="button" role="radio" aria-checked={!ev} className={!ev ? 'on' : ''} disabled={ed.readOnly} onClick={() => ev && setConfirm(ev)}>
                    No
                  </button>
                </div>
                {ev && (
                  <input
                    className="ios-value"
                    type="date"
                    aria-label={`${name}: date`}
                    disabled={ed.readOnly}
                    value={(ev[QUICK.date_field] as string) ?? ''}
                    onChange={(e) => ed.setField('OUTCOME_EVENTS', ev._id, QUICK.date_field, e.target.value || null)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      {confirm && (
        <Confirm
          title="Remove this event?"
          message="The event and its details will be removed from this case."
          confirmLabel="Remove"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            ed.removeRow('OUTCOME_EVENTS', confirm._id);
            setConfirm(null);
          }}
        />
      )}
    </>
  );
}

/** One follow-up visit: main fields first, quick events, then More fields and other events. */
function FollowUpRowSheet({ ed, id, onClose }: { ed: CaseEditor; id: string; onClose: () => void }) {
  const row = ed.rows('FOLLOW_UPS').find((r) => r._id === id) ?? null;
  const [confirm, setConfirm] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (open) return <RowSheet ed={ed} entity="OUTCOME_EVENTS" id={open} onClose={() => setOpen(null)} />;
  const same = row ? ed.rows('FOLLOW_UPS').filter((r) => r.procedure_id === row.procedure_id) : [];
  const primary = FU.primary_fields ?? [];
  const more = formFields(FU).map((f) => f.name).filter((n) => !primary.includes(n));
  const events = row ? ed.rows('OUTCOME_EVENTS').filter((e) => e[QUICK.fk] === id) : [];
  return (
    <Sheet title={row ? followUpTitle(row, same.indexOf(row)) : 'Follow-up'} onClose={onClose} onDone={onClose} testId="followup-sheet">
      {!row ? (
        <p className="muted">This follow-up was removed.</p>
      ) : (
        <>
          <RowForm ed={ed} entity="FOLLOW_UPS" rowId={id} row={row} only={primary} />
          <QuickEvents ed={ed} fu={row} />
          <details className="offer more-fields">
            <summary>More fields</summary>
            <RowForm ed={ed} entity="FOLLOW_UPS" rowId={id} row={row} only={more} />
          </details>
          <h3 className="sechead">Event details</h3>
          <div className="group">
            {events.map((e, k) => (
              <button key={e._id} className="grow-row" onClick={() => setOpen(e._id)}>
                <span className="grow">{rowTitle('OUTCOME_EVENTS', e, k)}</span>
                <Icon name="chevron" size={16} className="muted" />
              </button>
            ))}
            {!ed.readOnly && (
              <button className="grow-row add" onClick={() => setOpen(ed.addRow('OUTCOME_EVENTS', String(row.procedure_id), { [QUICK.fk]: id }))}>
                <Icon name="plus" size={18} /> Add another event
              </button>
            )}
            {ed.readOnly && !events.length && <div className="grow-row muted">None</div>}
          </div>
          {!ed.readOnly && (
            <button className="btn danger-text block" onClick={() => setConfirm(true)}>
              <Icon name="trash" size={18} /> Remove this follow-up
            </button>
          )}
        </>
      )}
      {confirm && (
        <Confirm
          title="Remove this follow-up?"
          message="Its values will be removed. Events recorded with it stay in the case."
          confirmLabel="Remove"
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            ed.removeRow('FOLLOW_UPS', id);
            onClose();
          }}
        />
      )}
    </Sheet>
  );
}

/** "Timeline & follow-up": follow-up visits and outcome events of each procedure. */
function FollowUpSheet({ ed, onClose }: { ed: CaseEditor; onClose: () => void }) {
  const [open, setOpen] = useState<{ entity: 'FOLLOW_UPS' | 'OUTCOME_EVENTS'; id: string } | null>(null);
  if (open?.entity === 'FOLLOW_UPS') return <FollowUpRowSheet ed={ed} id={open.id} onClose={() => setOpen(null)} />;
  if (open) return <RowSheet ed={ed} entity="OUTCOME_EVENTS" id={open.id} onClose={() => setOpen(null)} />;
  const procs = ed.rows('EP_PROCEDURES');
  return (
    <Sheet title="Timeline & Follow-up" onClose={onClose} onDone={onClose} testId="followups-sheet">
      {!procs.length && <p className="muted">Add a procedure first: each follow-up belongs to a procedure.</p>}
      {procs.map((p) => {
        const fus = ed.rows('FOLLOW_UPS').filter((r) => r.procedure_id === p._id);
        const loose = ed.rows('OUTCOME_EVENTS').filter((e) => e.procedure_id === p._id && !e[QUICK.fk]);
        return (
          <div key={p._id}>
            <h3 className="sechead">{procHeading(ed, p._id)}</h3>
            <div className="group" data-testid="followup-list">
              {fus.map((r, k) => (
                <button key={r._id} className="grow-row" onClick={() => setOpen({ entity: 'FOLLOW_UPS', id: r._id })} data-testid="followup-row">
                  <span className="grow">
                    <span className="line1">{followUpTitle(r, k)}</span>
                    <span className="sub">
                      {[r.followup_completion_status ? label('FOLLOW_UPS', 'followup_completion_status', String(r.followup_completion_status)) : null, `${ed.rows('OUTCOME_EVENTS').filter((e) => e[QUICK.fk] === r._id).length} events`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <Icon name="chevron" size={16} className="muted" />
                </button>
              ))}
              {loose.map((e, k) => (
                <button key={e._id} className="grow-row" onClick={() => setOpen({ entity: 'OUTCOME_EVENTS', id: e._id })}>
                  <span className="grow">{rowTitle('OUTCOME_EVENTS', e, k)}</span>
                  <Icon name="chevron" size={16} className="muted" />
                </button>
              ))}
              {!ed.readOnly && (
                <button className="grow-row add" onClick={() => setOpen({ entity: 'FOLLOW_UPS', id: ed.addRow('FOLLOW_UPS', p._id) })}>
                  <Icon name="plus" size={18} /> Add follow-up visit
                </button>
              )}
              {ed.readOnly && !fus.length && !loose.length && <div className="grow-row muted">None</div>}
            </div>
          </div>
        );
      })}
    </Sheet>
  );
}

function ChaSheet({ cha, onClose, onGo }: { cha: ChaResult; onClose: () => void; onGo: (section: string) => void }) {
  return (
    <Sheet title="CHA₂DS₂-VASc" closeLabel="Close" onClose={onClose} onDone={onClose} testId="cha-sheet">
      <div className="summary">
        <div>
          <b>{cha.score ?? '—'}</b>
          {cha.score === null ? 'incomplete' : 'points'}
        </div>
      </div>
      <div className="group">
        {cha.items.map((i) => (
          <div key={i.key} className="grow-row">
            <span className="grow">{i.label}</span>
            <span className={i.points === null ? 'muted small' : 'small'}>{i.points === null ? 'not known' : `+${i.points}`}</span>
          </div>
        ))}
      </div>
      <p className="note">Computed from the saved fields (baseline risk profile, date of birth on the episode date, sex at birth); never stored. No number until every item is Yes or No and age and sex are known.</p>
      <div className="group">
        <button className="grow-row" onClick={() => onGo('risk')}>
          <span className="grow">Open baseline risk profile</span>
          <Icon name="chevron" size={16} className="muted" />
        </button>
        <button className="grow-row" onClick={() => onGo('patient')}>
          <span className="grow">Open patient (date of birth, sex)</span>
          <Icon name="chevron" size={16} className="muted" />
        </button>
      </div>
    </Sheet>
  );
}

function ReportSheet({ ed, readiness, onClose }: { ed: CaseEditor; readiness: Readiness; onClose: () => void }) {
  const d = ed.detail!;
  const print = () => {
    api('POST', `/api/cases/${d.meta.case_id}/printed`, {}).catch(() => undefined);
    window.print();
  };
  return (
    <Sheet title="Case Report" closeLabel="Close" onClose={onClose} onDone={print} doneLabel="Print" testId="report-sheet" wide>
      <p className="muted small">Saved values only, with the dictionary labels. Print, or choose “Save as PDF” in the print window.</p>
      <div className="report-preview">
        <CaseReport d={d} rows={ed.rows} readiness={readiness} />
      </div>
      <button className="btn primary block" onClick={print}>
        Print / Save as PDF
      </button>
      <PrintPortal d={d} rows={ed.rows} readiness={readiness} />
    </Sheet>
  );
}

type OpenSheet =
  | { kind: 'cha' }
  | { kind: 'report' }
  | { kind: 'followup' }
  | { kind: 'procedure'; id: string; focus?: string }
  | { kind: 'section'; title: string; entities: string[]; focus?: string }
  | { kind: 'additional' }
  | { kind: 'ready' }
  | { kind: 'history' }
  | { kind: 'ai' }
  | { kind: 'cohorts' }
  | null;

export function CaseView({ id, nav, wide }: { id: string; nav: (p: string) => void; wide: boolean }) {
  const ed = useCaseEditor(id);
  const { can } = useAuth();
  const { toast, refreshCases } = useStore();
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const cohorts = useCohorts();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [na, setNa] = useState<{ entity: string; field: string; pid: string | null } | null>(null);
  const [reopening, setReopening] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = ed.detail;

  const head = useMemo(() => {
    if (!d) return null;
    const ep = ed.rows('EP_EPISODES')[0];
    const ident = ed.rows('PATIENT_IDENTIFIERS')[0];
    const pat = ed.rows('PATIENTS')[0];
    const start = (ep?.episode_start_date as string) ?? null;
    return { start, end: (ep?.episode_end_date as string) ?? null, age: ageOn(ident?.date_of_birth, start), sex: (pat?.sex_at_birth as string) ?? null };
  }, [d, ed]);

  const { rows: rowsOf } = ed;
  const allRows = useMemo(() => Object.fromEntries(Object.keys(dict.entities).map((e) => [e, rowsOf(e)])), [rowsOf]);
  const readiness = useMemo(() => evaluateReadiness(dict, allRows, ed.notAvailable, d?.ai ?? {}), [allRows, ed.notAvailable, d?.ai]);
  const cha = useMemo(() => (chaRelevant(allRows) ? cha2ds2vasc(allRows) : null), [allRows]);
  const caseCtx = useMemo<CaseCtx>(
    () => ({ readiness, checks: new Map(readiness.checks.map((c) => [c.key, c])), askNa: (entity, field, pid) => setNa({ entity, field, pid }) }),
    [readiness],
  );

  if (ed.loading && !d) {
    return (
      <section className="view" aria-busy="true">
        <p className="muted">
          <span className="spinner inline" /> Opening the case…
        </p>
      </section>
    );
  }
  if (ed.notFound || !d) {
    return (
      <section className="view">
        <Empty icon="cases" title={ed.notFound ? 'Case not found' : 'Could not open the case'}>
          <p>{ed.notFound ? 'It may have been deleted, or it is in a group you cannot see.' : ed.error}</p>
          <button className="btn" onClick={() => (ed.notFound ? nav('cases') : ed.reload())}>
            {ed.notFound ? 'Back to procedures' : 'Try again'}
          </button>
        </Empty>
      </section>
    );
  }

  const procs = ed.rows('EP_PROCEDURES');
  const comps = ed.rows('PROCEDURE_COMPONENTS');
  const completed = ed.readOnly;
  const aiWaiting = aiPending(d);
  const addProcedure = () => {
    const pid = ed.addRow('EP_PROCEDURES');
    setSheet({ kind: 'procedure', id: pid });
  };
  const countOf = (entities: string[]) => {
    let n = 0;
    for (const e of entities) {
      const def = dict.entities[e];
      if (def.cardinality === 'multi') n += ed.rows(e).length;
      else n += filledCount(e, ed.rows(e)[0]);
    }
    return n;
  };
  const statusLabel = (code: unknown) => (code ? `Procedure: ${label('EP_PROCEDURES', 'procedure_status', String(code))}` : null);
  const pct = readiness.total ? Math.round((readiness.done / readiness.total) * 100) : 0;

  const go = (i: Issue) => {
    const focus = `${i.entity}.${i.field}`;
    if (i.procedure_id) setSheet({ kind: 'procedure', id: i.procedure_id, focus });
    else {
      const row = dict.layout.groups.flatMap((g) => g.rows).find((r) => r.id === i.section);
      if (row) setSheet({ kind: 'section', title: row.label, entities: row.entities, focus });
    }
  };

  const complete = async () => {
    setBusy(true);
    try {
      await ed.flush();
      const r = await api<{ case: CaseDetail }>('POST', `/api/cases/${d.meta.case_id}/complete`, { row_version: ed.detail?.meta.row_version });
      ed.replace(r.case);
      setSheet(null);
      toast({ message: 'Case marked completed', kind: 'success' });
      refreshCases();
    } catch (e) {
      const err = e as ApiError;
      toast({ message: err.message, kind: 'error' });
      if (err.status === 409) ed.reload();
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (reason: string) => {
    setBusy(true);
    try {
      const r = await api<{ case: CaseDetail }>('POST', `/api/cases/${d.meta.case_id}/reopen`, { reason });
      ed.replace(r.case);
      setReopening(false);
      toast({ message: 'Case reopened', kind: 'success' });
      refreshCases();
    } catch (e) {
      toast({ message: (e as ApiError).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const naField = na ? fieldOf(na.entity, na.field) : null;
  const naCurrent = na ? (ed.notAvailable[naKey(na.entity, na.field, isProcedureLevel(dict, na.entity) ? na.pid : null)]?.reason ?? null) : null;

  return (
    <CaseContext.Provider value={caseCtx}>
      <section className={`view case-view${completed ? ' is-completed' : ''}`} aria-label="Case">
        <div className="navbar">
          {!wide ? (
            <a href="#/cases" className="back link">
              <Icon name="back" size={22} /> Procedures
            </a>
          ) : (
            <span />
          )}
          <span className="title">Case</span>
          <span className="right">{!completed && <SaveIndicator />}</span>
        </div>

        <div className="hcard" data-testid="case-head">
          <div className="hdate">{fmtDate(head?.start) || 'No episode date'}</div>
          <div className="muted small">
            Episode {fmtShortDate(head?.start)}
            {head?.end ? ` → ${fmtDate(head.end)}` : ''} · {d.meta.group_name} · No. {d.meta.group_seq}
          </div>
          <div className="hmrn">
            <b>MRN: {d.meta.mrn}</b> <span className="muted">{ageSex(head?.age ?? null, head?.sex ?? null)}</span>
          </div>
          <div className="small" style={{ marginTop: 8 }}>
            <span className={`status ${completed ? 's-done' : 's-prog'}`} data-testid="case-status">
              {completed ? 'Completed' : 'In progress'}
            </span>
            {cha && (
              <button className="chip c-neutral cha-chip" onClick={() => setSheet({ kind: 'cha' })} data-testid="cha-chip">
                CHA₂DS₂-VASc {cha.score === null ? 'incomplete' : cha.score}
              </button>
            )}
          </div>
          <div className="progress-row" data-testid="core-progress">
            <span>
              Core fields {readiness.done} of {readiness.total}
            </span>
            <span className="progress" role="progressbar" aria-label="Core fields" aria-valuemin={0} aria-valuemax={readiness.total} aria-valuenow={readiness.done}>
              <span style={{ width: `${pct}%` }} />
            </span>
          </div>
        </div>

        {completed && (
          <div className="banner done" data-testid="completed-banner">
            <Icon name="check" size={18} />
            <span className="grow">
              Completed{d.meta.completed_by_name ? ` by ${d.meta.completed_by_name}` : ''}
              {d.meta.completed_at ? ` on ${fmtDate(d.meta.completed_at.slice(0, 10))}` : ''}. Read only.
            </span>
            {can('case.reopen') && (
              <button className="btn small" onClick={() => setReopening(true)}>
                Reopen…
              </button>
            )}
          </div>
        )}

        {!completed && Object.keys(d.copied ?? {}).length > 0 && (
          <div className="banner info" data-testid="copied-banner">
            <Icon name="info" size={18} />
            <span className="grow">
              {Object.keys(d.copied).length} history value{Object.keys(d.copied).length === 1 ? ' was' : 's were'} {Object.values(d.copied)[0].replace(/^Copied/, 'copied')} (same MRN). Check them; they are marked
              “Copied”.
            </span>
          </div>
        )}

        {!completed && (aiWaiting.values.length > 0 || aiWaiting.conflicts.length > 0) && (
          <div className="banner info" data-testid="ai-banner">
            <Icon name="extract" size={18} />
            <span className="grow">
              {[
                aiWaiting.values.length ? `${aiWaiting.values.length} AI value${aiWaiting.values.length === 1 ? '' : 's'} to review` : '',
                aiWaiting.conflicts.length ? `${aiWaiting.conflicts.length} conflict${aiWaiting.conflicts.length === 1 ? '' : 's'}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
              . The case cannot be completed until they are accepted or resolved.
            </span>
            <button className="btn small" onClick={() => setSheet({ kind: 'ai' })}>
              Review
            </button>
          </div>
        )}

        <h2 className="sechead">Procedures</h2>
        <div className="group" data-testid="procedures">
          {procs.map((p, i) => {
            const types = comps.filter((c) => c.procedure_id === p._id).map((c) => codeLabel(fieldOf('PROCEDURE_COMPONENTS', 'component_type'), c.component_type));
            const sub = [p.procedure_start_datetime ? fmtShortDate(String(p.procedure_start_datetime)) : null, types.join(' + ') || null, statusLabel(p.procedure_status)].filter(Boolean).join(' · ');
            return (
              <button key={p._id} className="grow-row" onClick={() => setSheet({ kind: 'procedure', id: p._id })} data-testid="procedure-row">
                <span className="row-ic">
                  <Icon name="wave" size={22} />
                </span>
                <span className="grow">
                  <span className="line1">{procedureTitle(p, i)}</span>
                  <span className="sub">
                    {sub || 'No details yet'} · <CoreTally t={readiness.byProcedure[p._id]} />
                  </span>
                </span>
                <Icon name="chevron" size={16} className="muted" />
              </button>
            );
          })}
          {!completed && (
            <button className="grow-row add" onClick={addProcedure}>
              <span className="row-ic">
                <Icon name="plus" size={20} />
              </span>
              Add Procedure
            </button>
          )}
          {completed && !procs.length && <div className="grow-row muted">No procedures</div>}
        </div>

        {dict.layout.groups.map((g) => (
          <div key={g.id}>
            <h2 className="sechead">{g.label}</h2>
            <div className="group">
              {g.rows.map((r) => {
                const later = r.entities.map((e) => dict.entities[e].later).find(Boolean);
                const t = readiness.bySection[r.id];
                return (
                  <button
                    key={r.id}
                    className="grow-row"
                    disabled={!!later}
                    onClick={() => setSheet(r.id === 'followup' ? { kind: 'followup' } : { kind: 'section', title: r.label, entities: r.entities })}
                    data-testid={`section-${r.id}`}
                  >
                    <span className="row-ic">
                      <Icon name={r.icon} size={22} />
                    </span>
                    <span className="grow">{r.label}</span>
                    <span className="muted small">{later ? `Comes in ${later}` : t?.total ? `core ${t.done}/${t.total}` : countOf(r.entities) || '—'}</span>
                    {!later && <Icon name="chevron" size={16} className="muted" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <h2 className="sechead">Additional clinical information</h2>
        <div className="group">
          <button className="grow-row add" onClick={() => setSheet({ kind: 'additional' })} disabled={completed && !d.additional.length}>
            <span className="row-ic">
              <Icon name={d.additional.length ? 'edit' : 'plus'} size={20} />
            </span>
            {d.additional.length ? `${d.additional.length} item${d.additional.length === 1 ? '' : 's'}` : completed ? 'None' : 'Add Information'}
          </button>
        </div>

        <h2 className="sechead">Case</h2>
        <div className="group">
          {can('ai.extract') && !completed && (
            <button className="grow-row" onClick={() => setSheet({ kind: 'ai' })} data-testid="ai-row">
              <span className="row-ic">
                <Icon name="extract" size={22} />
              </span>
              <span className="grow">AI Assistant</span>
              <span className="muted small">Fill from a clinical note</span>
              <Icon name="chevron" size={16} className="muted" />
            </button>
          )}
          {(cohorts.length > 0 || can('cohorts.manage')) && (
            <button className="grow-row" onClick={() => setSheet({ kind: 'cohorts' })} data-testid="cohorts-row">
              <span className="row-ic">
                <Icon name="patients" size={22} />
              </span>
              <span className="grow">Cohorts</span>
              <span className="muted small">{(d.summary.cohorts ?? []).length || ''}</span>
              <Icon name="chevron" size={16} className="muted" />
            </button>
          )}
          <button className="grow-row" onClick={() => setSheet({ kind: 'history' })} data-testid="history-row">
            <span className="row-ic">
              <Icon name="cal" size={22} />
            </span>
            <span className="grow">History</span>
            <span className="muted small">
              {d.history_count} change{d.history_count === 1 ? '' : 's'}
            </span>
            <Icon name="chevron" size={16} className="muted" />
          </button>
          {can('report.pdf') && (
            <button className="grow-row" onClick={() => setSheet({ kind: 'report' })} data-testid="report-row">
              <span className="row-ic">
                <Icon name="doc" size={22} />
              </span>
              <span className="grow">Case report (PDF)</span>
              <Icon name="chevron" size={16} className="muted" />
            </button>
          )}
        </div>

        {can('case.delete') && !completed && (
          <button className="btn danger-text block delete-case" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={18} /> Delete case
          </button>
        )}

        {!completed && (
          <div className="bottomact" data-testid="complete-bar">
            <span className="grow">{readiness.blockers.length ? `${readiness.blockers.length} missing` : 'Ready'}</span>
            <button className="btn" onClick={() => setSheet({ kind: 'ready' })}>
              Ready to complete?
            </button>
            {can('case.complete') && (
              <button className="btn primary" disabled={!readiness.canComplete || busy || ed.pending > 0} onClick={complete}>
                Complete
              </button>
            )}
          </div>
        )}

        {sheet?.kind === 'procedure' && <ProcedureSheet ed={ed} id={sheet.id} focus={sheet.focus} onClose={() => setSheet(null)} />}
        {sheet?.kind === 'section' && <SectionSheet ed={ed} title={sheet.title} entities={sheet.entities} focus={sheet.focus} onClose={() => setSheet(null)} />}
        {sheet?.kind === 'additional' && <AdditionalSheet ed={ed} onClose={() => setSheet(null)} />}
        {sheet?.kind === 'followup' && <FollowUpSheet ed={ed} onClose={() => setSheet(null)} />}
        {sheet?.kind === 'report' && <ReportSheet ed={ed} readiness={readiness} onClose={() => setSheet(null)} />}
        {sheet?.kind === 'cha' && cha && (
          <ChaSheet
            cha={cha}
            onClose={() => setSheet(null)}
            onGo={(id) => {
              const row = dict.layout.groups.flatMap((g) => g.rows).find((r) => r.id === id)!;
              setSheet({ kind: 'section', title: row.label, entities: row.entities });
            }}
          />
        )}
        {sheet?.kind === 'ready' && <ReadySheet ed={ed} busy={busy} onGo={go} onComplete={complete} onClose={() => setSheet(null)} />}
        {sheet?.kind === 'ai' && <AiSheet ed={ed} procs={procs.map((p) => ({ id: p._id, title: procHeading(ed, p._id) }))} onClose={() => setSheet(null)} />}
        {sheet?.kind === 'history' && <HistorySheet caseId={d.meta.case_id} onClose={() => setSheet(null)} />}
        {sheet?.kind === 'cohorts' && <CaseCohortsSheet caseId={d.meta.case_id} member={d.summary.cohorts ?? []} onChanged={() => Promise.all([ed.reload(), refreshCases()])} onClose={() => setSheet(null)} />}
        {na && naField && (
          <NaDialog
            label={naField.label}
            current={naCurrent}
            onClose={() => setNa(null)}
            onSave={(reason) => {
              ed.setNotAvailable(na.entity, na.field, isProcedureLevel(dict, na.entity) ? na.pid : null, reason);
              setNa(null);
            }}
          />
        )}
        {reopening && <ReasonDialog busy={busy} onClose={() => setReopening(false)} onReopen={reopen} />}
        {confirmDelete && (
          <Confirm
            title="Delete this case?"
            message={`MRN ${d.meta.mrn} · ${d.meta.group_name} No. ${d.meta.group_seq} will go to the recycle bin. An Admin can restore it with its number.`}
            confirmLabel="Delete case"
            onCancel={() => setConfirmDelete(false)}
            onConfirm={async () => {
              setConfirmDelete(false);
              await ed.flush();
              try {
                await api('POST', `/api/cases/${d.meta.case_id}/delete`, {});
                toast({ message: 'Case moved to the recycle bin', kind: 'success' });
                await refreshCases();
                nav('cases');
              } catch (e) {
                toast({ message: (e as Error).message, kind: 'error' });
              }
            }}
          />
        )}
      </section>
    </CaseContext.Provider>
  );
}

export { displayValue };
