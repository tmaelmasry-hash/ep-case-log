// Case page (approved EP Log-style preview): header card, then grouped rows; each row opens its form in a sheet.
// Case = one EP_EPISODE; PROCEDURES lists the episode's EP_PROCEDURES, each with its components and modules.
import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { codeLabel, displayValue, formFields, hasValue, type FormField } from '../../shared/dictionary.ts';
import { ageOn, type CaseDetail, type DecodedRow, type HistoryItem } from '../../shared/caseTypes.ts';
import { NA_REASONS, evaluateReadiness, isProcedureLevel, naKey, type CoreCheck, type Issue, type Readiness } from '../../shared/readiness.ts';
import { COMPLICATION_ENTITIES, completenessBySection, type CompletenessRow } from '../../shared/completeness.ts';
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
import { bmi } from '../../shared/derive.ts';
import { CaseReport, PrintPortal } from './CaseReport';
import { AiSheet, aiPending } from './AiAssistant';
import { CaseCohortsSheet } from '../components/CaseCohortsSheet';
import { MoveCaseSheet } from '../components/MoveCaseSheet';
import { caseEnv, consequences, evaluate, fieldRules, type Consequence } from '../../shared/rules.ts';
import { useCohorts } from '../lib/cohorts';
import { PROCEDURE_ITEMS, componentsToDrop, itemOn, showsDevice, showsLeads, type ItemFacts, type ProcedureItem } from '../../shared/procedureTypes.ts';
import { seqText } from '../lib/offlineCase';
import { PathwayTag, procedureChip } from './CasesView';
import { devicePathway } from '../../shared/pathway.ts';
import { groupColor } from '../lib/filters';
import { hijriLabel } from '../lib/hijri';
import { rowInSection, type LayoutRow } from '../../shared/dictionary.ts';
import { sync, useOnline } from '../lib/sync';

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

/** Values a person entered in a row and in the rows that point to it (procedure sections, nested rows, events). */
function enteredCount(ed: CaseEditor, entity: string, id: string): number {
  let n = filledCount(entity, ed.rows(entity).find((r) => r._id === id));
  for (const e of Object.keys(dict.entities)) {
    for (const r of ed.rows(e)) if (r._id !== id && Object.values(r).includes(id)) n += 1 + filledCount(e, r);
  }
  return n;
}

/** Cancel on a row that was just added takes it away again, so no empty procedure or row stays behind (owner,
 *  24 Oct). Nothing entered yet: it goes at once; something entered: ask first. Done keeps it. */
function useNewRow(ed: CaseEditor, entity: string, id: string, what: string, onClose: () => void) {
  const [base] = useState(() => enteredCount(ed, entity, id));
  const [ask, setAsk] = useState(false);
  const discard = () => {
    setAsk(false);
    ed.removeRow(entity, id);
    onClose();
  };
  const cancel = () => {
    if (!ed.isNew(id) || ed.readOnly || !ed.rows(entity).some((r) => r._id === id)) onClose();
    else if (enteredCount(ed, entity, id) > base) setAsk(true);
    else discard();
  };
  const done = () => {
    ed.keepRow(id);
    onClose();
  };
  const dialog = ask && (
    <Confirm
      title={`Discard this new ${what}?`}
      message="What you entered in it will be removed. To keep it, press Done."
      confirmLabel="Discard"
      onCancel={() => setAsk(false)}
      onConfirm={discard}
    />
  );
  return { cancel, done, dialog };
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

/** Field review phase 2: a study's "procedure" link is asked only when the case has two or more procedures (the app
 *  links the only one), and the procedure type is set from the ticked items, never picked. */
function autoSkip(ed: CaseEditor, entity: string): string[] {
  const out: string[] = [];
  if (entity === 'EP_PROCEDURES') out.push('primary_procedure_type');
  else if (ed.rows('EP_PROCEDURES').length < 2 && dict.entities[entity].scope !== 'procedure') out.push('procedure_id');
  return out;
}

/** A value the app calculates here (shared/derive.ts) is read only. */
function lockedNote(entity: string, field: string, row: DecodedRow | null): string | undefined {
  if (entity === 'LAB_RESULTS' && field === 'egfr_ml_min_1_73m2' && hasValue(row?.creatinine_umol_l)) return 'calculated';
  return undefined;
}

/** One row of an entity as a form; creates the row on the first edit when it does not exist yet. */
function RowForm({ ed, entity, rowId, parentId, row, only, skip, offerOf }: { ed: CaseEditor; entity: string; rowId: string; parentId?: string | null; row: DecodedRow | null; only?: string[]; skip?: string[]; offerOf?: (field: string) => string[] | undefined }) {
  const fk = useFk(ed);
  const c = useCase();
  const exists = !!row;
  const pid = scopeOf(entity, rowId, parentId, row);
  const [ask, setAsk] = useState<{ field: string; value: unknown; key?: string; list: Consequence[] } | null>(null);
  // M-1 dynamic-form rules: this procedure's (or the case's) answers decide what applies here.
  const env = caseEnv(dict.entities, ed.rows, pid, { entity, row });
  const ruling = (field: string) => (dict.rules.byTarget.has(`${entity}.${field}`) ? fieldRules(dict.rules, entity, field, env) : undefined);
  const save = (field: string, value: unknown, key?: string) => ed.setField(entity, rowId, field, value, { key, create: exists ? undefined : { parent_id: parentId ?? null } });
  const rowIdOf = (e: string) => (e === entity ? rowId : e === 'EP_PROCEDURES' ? pid : dict.entities[e].scope === 'procedure' ? ed.rows(e).find((r) => r.procedure_id === pid)?._id : ed.rows(e)[0]?._id);
  const labelOf = (e: string, f: string) => dict.entities[e].fields.find((x) => x.name === f)?.label ?? f;
  return (
    <>
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
        skip={[...(skip ?? []), ...autoSkip(ed, entity)]}
        offerOf={offerOf}
        lockedOf={(field) => lockedNote(entity, field, row)}
        ruling={ruling}
        onChange={(field, value, key) => {
          // A change that makes other answers not apply asks first (EP Workspace M-1: Remove n answers / Keep).
          const list = key ? [] : consequences(dict.rules, dict.entities, ed.rows, pid, entity, field, value);
          if (list.length) setAsk({ field, value, key, list });
          else save(field, value, key);
        }}
      />
      {ask && (
        <Confirm
          title={`Remove ${ask.list.length} answer${ask.list.length === 1 ? '' : 's'}?`}
          message={
            <>
              <p>With this change, these answers no longer apply:</p>
              <ul data-testid="rule-consequences">
                {ask.list.map((x) => (
                  <li key={`${x.entity}.${x.field}`}>{labelOf(x.entity, x.field)}</li>
                ))}
              </ul>
            </>
          }
          confirmLabel={`Remove ${ask.list.length} answer${ask.list.length === 1 ? '' : 's'}`}
          onConfirm={() => {
            save(ask.field, ask.value, ask.key);
            for (const x of ask.list) {
              const id = rowIdOf(x.entity);
              if (id) ed.setField(x.entity, id, x.field, null);
            }
            setAsk(null);
          }}
          onCancel={() => setAsk(null)}
        />
      )}
    </>
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
  const env = caseEnv(dict.entities, ed.rows, null, { entity: parentEntity, row: ed.rows(parentEntity).find((r) => r._id === parentId) ?? null });
  return (
    <>
      {children.map((child) => {
        const kids = ed.rows(child.entity).filter((k) => k[child.nest_under!.fk] === parentId);
        // A section shown only for some answers (layout show_when) stays listed while it holds saved rows.
        if (child.show_when && !kids.length && evaluate(child.show_when, env) !== true) return null;
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
  const [child, setChild] = useState<{ entity: string; id: string } | null>(null);
  const fresh = useNewRow(ed, entity, id, def.label.toLowerCase(), onClose);
  if (child) return <RowSheet ed={ed} entity={child.entity} id={child.id} onClose={() => setChild(null)} />;
  return (
    <Sheet title={row ? rowTitle(entity, row, i) : def.label} onClose={fresh.cancel} onDone={fresh.done} testId="row-sheet">
      {fresh.dialog}
      {!row ? (
        <p className="muted">This row was removed.</p>
      ) : (
        <>
          <RowForm ed={ed} entity={entity} rowId={id} row={row} />
          <NestedLists ed={ed} parentEntity={entity} parentId={id} onOpen={(e, cid) => setChild({ entity: e, id: cid })} />
          {!ed.readOnly && (
            <button
              className="btn danger-text block"
              onClick={() => {
                // Owner step 8: removed at once, with Undo instead of a question.
                ed.removeWithUndo([{ entity, id }], `${def.label} removed`);
                onClose();
              }}
            >
              <Icon name="trash" size={18} /> Remove {def.label.toLowerCase()}
            </button>
          )}
        </>
      )}
    </Sheet>
  );
}

/** Height and weight live with the patient's basics (owner, field review); BMI is calculated, never stored. */
const BASICS = ['height_cm', 'weight_kg'];

function PatientBasics({ ed }: { ed: CaseEditor }) {
  const id = ed.slot('CLINICAL_PROFILE_SNAPSHOTS', ed.detail!.meta.case_id);
  const row = ed.rows('CLINICAL_PROFILE_SNAPSHOTS').find((r) => r._id === id) ?? null;
  const b = bmi(row?.height_cm, row?.weight_kg);
  return (
    <div data-testid="patient-basics">
      <RowForm ed={ed} entity="CLINICAL_PROFILE_SNAPSHOTS" rowId={id} row={row} only={BASICS} />
      <div className="group">
        <div className="frow inline">
          <span className="lab">
            BMI <span className="muted small">(calculated)</span>
          </span>
          <span className="val" data-testid="bmi">
            {b ?? '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Field review phase 2: these studies start with "Done / Not done"; Done adds the study (with its type) and opens it. */
const DONE_FIRST: Record<string, { label: string; values?: Record<string, string> }[]> = {
  TILT_TESTS: [{ label: 'Tilt-table test' }],
  ADVANCED_IMAGING: [
    { label: 'CMR', values: { modality_code: 'CMR' } },
    { label: 'Cardiac CT', values: { modality_code: 'CARDIAC_CT' } },
    { label: 'TEE', values: { modality_code: 'TEE' } },
  ],
};

function DoneFirst({ ed, entity, options, onOpen }: { ed: CaseEditor; entity: string; options: { label: string; values?: Record<string, string> }[]; onOpen: (id: string) => void }) {
  const def = dict.entities[entity];
  const mine = (o: { values?: Record<string, string> }) => ed.rows(entity).filter((r) => Object.entries(o.values ?? {}).every(([k, v]) => r[k] === v));
  return (
    <div data-testid={`done-${entity}`}>
      <h3 className="sechead">{entity === 'ADVANCED_IMAGING' ? 'Imaging' : def.label}</h3>
      <div className="group">
        {options.map((o) => {
          const rows = mine(o);
          return (
            <div key={o.label}>
              <div className="frow stack">
                <span className="lab">{o.label}</span>
                <div className="mini-seg choice-seg" role="radiogroup" aria-label={o.label}>
                  <button type="button" role="radio" aria-checked={rows.length > 0} className={rows.length ? 'on' : ''} disabled={ed.readOnly} onClick={() => (rows.length ? onOpen(rows[0]._id) : onOpen(ed.addRow(entity, null, o.values)))}>
                    Done
                  </button>
                  <button type="button" role="radio" aria-checked={!rows.length} className={rows.length ? '' : 'on'} disabled={ed.readOnly} onClick={() => rows.length && ed.removeWithUndo(rows.map((r) => ({ entity, id: r._id })), `${o.label} marked Not done`)}>
                    Not done
                  </button>
                </div>
              </div>
              {rows.map((r, i) => (
                <button key={r._id} className="grow-row" onClick={() => onOpen(r._id)} data-testid="list-row">
                  <span className="grow">{rowTitle(entity, r, i)}</span>
                  <span className="muted small">{filledCount(entity, r)} filled</span>
                  <Icon name="chevron" size={16} className="muted" />
                </button>
              ))}
              {rows.length > 0 && !ed.readOnly && (
                <button className="grow-row add" onClick={() => onOpen(ed.addRow(entity, null, o.values))}>
                  <Icon name="plus" size={18} /> Add another
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A layout row (e.g. "Patient", "ECG", "Devices"): one-per-case sections as forms, repeatable ones as lists. */
function SectionSheet({ ed, title, entities, values, focus, cha, onClose }: { ed: CaseEditor; title: string; entities: string[]; values?: Record<string, string>; focus?: string; cha?: ChaResult | null; onClose: () => void }) {
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
              <RowForm ed={ed} entity={entity} rowId={id} row={row} skip={entity === 'CLINICAL_PROFILE_SNAPSHOTS' ? BASICS : undefined} />
              {entity === 'CLINICAL_PROFILE_SNAPSHOTS' && cha && <ChaLine cha={cha} />}
              {entity === 'PATIENTS' && <PatientBasics ed={ed} />}
              {row && <NestedLists ed={ed} parentEntity={entity} parentId={id} onOpen={(e, cid) => setOpen({ entity: e, id: cid })} />}
            </div>
          );
        }
        const rows = ed.rows(entity);
        const done = DONE_FIRST[entity]?.filter((o) => Object.entries(values ?? {}).every(([k, v]) => o.values?.[k] === v));
        if (done) return <DoneFirst key={entity} ed={ed} entity={entity} options={done} onOpen={(rid) => setOpen({ entity, id: rid })} />;
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

/** Items ticked for a procedure, kept until the answers that tell device items apart exist. Saved with the case
 *  (owner 30 Oct); a tick older builds kept on this device only (localStorage) is read once and moved to the case. */
function usePickedItems(ed: CaseEditor, procedureId: string): [string[], (v: string[]) => void] {
  const saved = ed.pickedItems[procedureId];
  useEffect(() => {
    if (!ed.detail || ed.readOnly || saved) return;
    const key = `kamc-proc-items-${procedureId}`;
    try {
      const old = (JSON.parse(localStorage.getItem(key) ?? '[]') as unknown[]).filter((x): x is string => PROCEDURE_ITEMS.some((i) => i.id === x));
      if (old.length) ed.setPickedItems(procedureId, old);
      localStorage.removeItem(key);
    } catch {
      /* storage blocked or unreadable: nothing to move */
    }
  }, [ed, procedureId, saved]);
  return [saved ?? [], (next) => ed.setPickedItems(procedureId, next)];
}

/** R3-1: the case device (type, manufacturer, model) and its leads, entered inside a device procedure. Same rows as Devices. */
function DeviceSection({ ed, leads, offer, onOpen }: { ed: CaseEditor; leads: boolean; offer?: string[]; onOpen: (entity: string, id: string) => void }) {
  const devId = ed.slot('DEVICES', ed.detail!.meta.case_id);
  const dev = ed.rows('DEVICES').find((r) => r._id === devId) ?? null;
  const rows = ed.rows('DEVICE_LEADS');
  return (
    <div data-testid="device-section">
      <h3 className="sechead">{dict.entities.DEVICES.label}</h3>
      <RowForm ed={ed} entity="DEVICES" rowId={devId} row={dev} offerOf={(f) => (f === 'current_device_type' && offer?.length ? offer : undefined)} />
      {leads && (
        <>
          <h3 className="sechead">Leads</h3>
          <div className="group" data-testid="device-leads">
            {rows.map((r, i) => (
              <button key={r._id} className="grow-row" onClick={() => onOpen('DEVICE_LEADS', r._id)}>
                <span className="grow">{rowTitle('DEVICE_LEADS', r, i)}</span>
                <span className="muted small">{filledCount('DEVICE_LEADS', r)} filled</span>
                <Icon name="chevron" size={16} className="muted" />
              </button>
            ))}
            {!ed.readOnly && (
              <button className="grow-row add" onClick={() => onOpen('DEVICE_LEADS', ed.addRow('DEVICE_LEADS'))}>
                <Icon name="plus" size={18} /> Add lead
              </button>
            )}
            {ed.readOnly && !rows.length && <div className="grow-row muted">None</div>}
          </div>
        </>
      )}
    </div>
  );
}

/** Adds the components (and preset answer) of a "What was done" item to a procedure. */
function addItem(ed: CaseEditor, pid: string, item: ProcedureItem, types: string[], presetRow: DecodedRow | null) {
  for (const code of item.components)
    if (!types.includes(code)) {
      ed.addRow('PROCEDURE_COMPONENTS', pid, { component_type: code });
      types.push(code);
    }
  if (item.preset && !hasValue(presetRow?.[item.preset.field])) {
    ed.setField(item.preset.entity, presetRow?._id ?? ed.slot(item.preset.entity, pid), item.preset.field, item.preset.value, { create: { parent_id: pid } });
  }
}

/** Step 1 of a new procedure (owner, 28 Oct): its date and what was done; Next opens only those sections. */
function AddProcedureSheet({ ed, onNext, onClose }: { ed: CaseEditor; onNext: (pid: string) => void; onClose: () => void }) {
  const procs = ed.rows('EP_PROCEDURES');
  const last = procs.map((p) => String(p.procedure_start_datetime ?? '').slice(0, 10)).filter(Boolean).sort().pop();
  const [date, setDate] = useState(last ?? String(ed.rows('EP_EPISODES')[0]?.episode_start_date ?? '').slice(0, 10));
  const [chosen, setChosen] = useState<string[]>([]);
  const hijri = hijriLabel(date);
  const next = () => {
    const pid = ed.addRow('EP_PROCEDURES', null, date ? { procedure_start_datetime: date } : undefined);
    const types: string[] = [];
    const items = PROCEDURE_ITEMS.filter((x) => chosen.includes(x.id));
    for (const item of items) addItem(ed, pid, item, types, null);
    ed.setPickedItems(pid, items.map((x) => x.id));
    onNext(pid);
  };
  return (
    <Sheet title="Add procedure" onClose={onClose} testId="addproc-sheet">
      <div className="group">
        <div className="frow inline">
          <label htmlFor="addproc-date" className="lab-wrap">
            <span className="lab">Procedure date</span>
          </label>
          <input id="addproc-date" className="ios-value" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          {hijri && <div className="frow-err muted small">{hijri}</div>}
        </div>
      </div>
      <h3 className="sechead">What was done? (one or more)</h3>
      <div className="group">
        <div className="frow stack">
          {(['Ablation', 'Devices', 'Other'] as const).map((g) => (
            <div key={g}>
              <div className="item-group">{g}</div>
              <div className="pill-set" role="group" aria-label={g}>
                {PROCEDURE_ITEMS.filter((x) => x.group === g).map((x) => (
                  <button key={x.id} type="button" aria-pressed={chosen.includes(x.id)} className={chosen.includes(x.id) ? 'on' : ''} onClick={() => setChosen((c) => (c.includes(x.id) ? c.filter((y) => y !== x.id) : [...c, x.id]))}>
                    {x.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <button className="btn primary block wide-btn" disabled={!chosen.length} onClick={next} data-testid="addproc-next">
        {chosen.length ? `Next (${chosen.length} chosen)` : 'Choose what was done'}
      </button>
    </Sheet>
  );
}

/** A part of the procedure sheet that opens and closes, with what is still missing in it. */
function Part({ id, title, missing, closed, onToggle, children, testId }: { id: string; title: string; missing: number; closed: boolean; onToggle: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <section className="proc-part" id={id} data-testid={testId}>
      <button type="button" className="part-head" aria-expanded={!closed} onClick={onToggle}>
        <Icon name={closed ? 'chevron' : 'down'} size={16} className="muted" />
        <span className="grow">{title}</span>
        {missing ? <span className="missing small">{missing} missing</span> : <span className="ok-text">✓</span>}
      </button>
      {!closed && <div className="part-body">{children}</div>}
    </section>
  );
}

/** EP_PROCEDURES questions shown in their own part, "Mapping & access" (owner approved the step 4 preview). */
const MAPPING = ['electroanatomic_mapping_used', 'mapping_system', 'intracardiac_echo_used', 'transseptal_access', 'contrast_used', 'contrast_volume_ml'];

/** R4-7 "Next missing": each press goes to the next missing core item of this procedure in screen order (wraps),
 *  opens its part and marks it for 2 s. Only moves the view; saving and statuses are unchanged. */
function NextMissing({ items, parts, partOf, openPart }: { items: CoreCheck[]; parts: string[]; partOf: (x: CoreCheck) => string; openPart: (part: string) => void }) {
  const [last, setLast] = useState<{ key: string; at: number } | null>(null);
  if (!items.length) return null;
  const elOf = (x: CoreCheck) => document.querySelector<HTMLElement>(`[data-testid="procedure-sheet"] [data-field="${x.entity}.${x.field}"]`);
  const fieldIndex = (x: CoreCheck) => dict.entities[x.entity]?.fields.findIndex((f) => f.name === x.field) ?? 0;
  // Screen order: by part, then by place on the page (dictionary order when a field is not on the page).
  const list = [...items].sort((a, b) => {
    const pa = parts.indexOf(partOf(a));
    const pb = parts.indexOf(partOf(b));
    if (pa !== pb) return pa - pb;
    const ea = elOf(a);
    const eb = elOf(b);
    if (ea && eb && ea !== eb) return ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    return a.entity === b.entity ? fieldIndex(a) - fieldIndex(b) : 0;
  });
  // The item after the last one visited; when that one was just filled, the list is shorter and the same place is next.
  const at = last ? list.findIndex((x) => x.key === last.key) : -1;
  const k = !last ? 0 : at >= 0 ? (at + 1) % list.length : Math.min(last.at, list.length - 1);
  // The count shows where you are now (owner, 30 Oct): the item last visited; before the first press, the first one.
  // When the visited item was just filled, the place before the next one.
  const here = !last ? 1 : at >= 0 ? at + 1 : Math.max(1, Math.min(last.at, list.length));
  const press = () => {
    const target = list[k];
    setLast({ key: target.key, at: k });
    const part = partOf(target);
    openPart(part);
    window.setTimeout(() => {
      const el = elOf(target) ?? document.getElementById(part);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('next-mark');
      window.setTimeout(() => el.classList.remove('next-mark'), 2000);
      // Keyboard focus on desktop only, so a phone keyboard does not cover the sheet.
      if (window.matchMedia?.('(pointer: fine)').matches) el.querySelector<HTMLElement>('input, select, textarea')?.focus({ preventScroll: true });
    }, 60);
  };
  return (
    <div className="next-missing">
      <button type="button" className="btn primary block" onClick={press} data-testid="next-missing">
        Next missing
        <span className="next-count">
          {here} of {list.length}
        </span>
        <Icon name="down" size={18} />
      </button>
    </div>
  );
}

/** One procedure: its EP_PROCEDURES fields, components, the modules they call for, and its complications.
 *  Owner, 28 Oct (step 4): tabs General · each type · Complications that jump to their part; the "Done" row and the
 *  tabs stay on top while scrolling; each part opens and closes and shows what is missing. */
function ProcedureSheet({ ed, id, focus, onClose }: { ed: CaseEditor; id: string; focus?: string; onClose: () => void }) {
  const c = useCase();
  useFocusField(focus);
  const procs = ed.rows('EP_PROCEDURES');
  const i = procs.findIndex((p) => p._id === id);
  const p = procs[i];
  const [extra, setExtra] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<null | 'procedure' | { componentIds: string[]; module: string }>(null);
  const [open, setOpen] = useState<{ entity: string; id: string } | null>(null);
  const comps = ed.rows('PROCEDURE_COMPONENTS').filter((c) => c.procedure_id === id);
  const types = comps.map((c) => String(c.component_type));
  const ptype = p?.primary_procedure_type;
  const [picked, setPicked] = usePickedItems(ed, id);
  const fresh = useNewRow(ed, 'EP_PROCEDURES', id, 'procedure', onClose);
  // The ticks stay open for a procedure just added; otherwise "Edit" opens them.
  const [editTicks, setEditTicks] = useState(() => ed.isNew(id));
  const [tab, setTab] = useState('part-general');
  const [closedParts, setClosedParts] = useState<string[]>([]);
  const partProps = (pid: string) => ({ closed: closedParts.includes(pid), onToggle: () => setClosedParts((x) => (x.includes(pid) ? x.filter((y) => y !== pid) : [...x, pid])) });
  // The tab follows the part being read: the last part whose top has passed under the bar.
  useEffect(() => {
    const body = document.querySelector('[data-testid="procedure-sheet"] .sheet-body');
    const bar = document.querySelector('[data-testid="proc-bar"]');
    if (!body || !bar) return;
    const onScroll = () => {
      const edge = bar.getBoundingClientRect().bottom + 12;
      let cur = 'part-general';
      for (const el of body.querySelectorAll<HTMLElement>('.proc-part')) {
        if (el.getBoundingClientRect().top <= edge) cur = el.id === 'part-mapping' ? 'part-general' : el.id;
      }
      setTab(cur);
    };
    body.addEventListener('scroll', onScroll, { passive: true });
    return () => body.removeEventListener('scroll', onScroll);
  }, [open]);

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

  const facts: ItemFacts = {
    components: types,
    deviceType: ed.rows('DEVICES')[0]?.current_device_type,
    strategy: moduleRow('CRT_CSP_PROCEDURES')?.cpp_strategy,
    deviceAction: moduleRow('DEVICE_IMPLANTS')?.device_action,
    picked,
  };
  const ticked = PROCEDURE_ITEMS.filter((x) => itemOn(x, facts));
  const deviceOffer = [...new Set(PROCEDURE_ITEMS.filter((x) => x.deviceTypes && (ticked.includes(x) || picked.includes(x.id))).flatMap((x) => x.deviceTypes!))];

  // Owner field review phase 2: tick what was done; each item adds its components (and opens their sections).
  const toggleItem = (item: ProcedureItem) => {
    if (!ticked.includes(item)) {
      addItem(ed, id, item, [...types], item.preset ? moduleRow(item.preset.entity) : null);
      setPicked([...picked.filter((x) => x !== item.id), item.id]);
      return;
    }
    setPicked(picked.filter((x) => x !== item.id));
    const drop = componentsToDrop(item, facts);
    const mod = MODULES.find((m) => m.module!.some((t) => drop.includes(t)) && moduleRow(m.entity) && filledCount(m.entity, moduleRow(m.entity)!) > 2);
    const ids = comps.filter((c) => drop.includes(String(c.component_type))).map((c) => c._id);
    if (mod && ids.length) setConfirm({ componentIds: ids, module: mod.label });
    else for (const cid of ids) ed.removeRow('PROCEDURE_COMPONENTS', cid);
  };

  const review = ed.slot('EXT_PROCEDURE_REVIEW', id);
  const complications = ed.rows('COMPLICATIONS').filter((c) => c.procedure_id === id);

  const missingOf = (pred: (x: CoreCheck) => boolean) => c.readiness.checks.filter((x) => x.procedure_id === id && x.state === 'missing' && pred(x)).length;
  const moduleSet = new Set(shown.map((m) => m.entity));
  const missMapping = missingOf((x) => x.entity === 'EP_PROCEDURES' && MAPPING.includes(x.field));
  const missDetails = missingOf((x) => !(x.entity === 'EP_PROCEDURES' && MAPPING.includes(x.field)) && !moduleSet.has(x.entity) && !COMPLICATION_ENTITIES.includes(x.entity));
  const missComplications = missingOf((x) => COMPLICATION_ENTITIES.includes(x.entity));
  const t = c.readiness.byProcedure[id];
  const left = t ? t.total - t.done : 0;
  const date = p.procedure_start_datetime ? String(p.procedure_start_datetime).slice(0, 10) : null;
  const name =
    ptype !== 'ABLATION' && types.length
      ? types.map((x) => label('PROCEDURE_COMPONENTS', 'component_type', x)).join(' + ')
      : procedureChip({ id, start: null, status: null, type: (ptype as string) ?? null, components: types }).text;
  const tabs = [
    { id: 'part-general', label: 'General', missing: missDetails + missMapping },
    ...shown.map((m) => ({ id: `part-${m.entity}`, label: m.label.replace(/ ablation$/i, ''), missing: missingOf((x) => x.entity === m.entity) })),
    { id: 'part-complications', label: 'Complications', missing: missComplications },
  ];
  const jump = (tid: string) => document.getElementById(tid)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const partOf = (x: CoreCheck) =>
    COMPLICATION_ENTITIES.includes(x.entity) ? 'part-complications' : x.entity === 'EP_PROCEDURES' && MAPPING.includes(x.field) ? 'part-mapping' : moduleSet.has(x.entity) ? `part-${x.entity}` : 'part-general';
  const missingHere = c.readiness.checks.filter((x) => x.procedure_id === id && x.state === 'missing');

  return (
    <Sheet title={name} onClose={fresh.cancel} onDone={fresh.done} testId="procedure-sheet">
      {fresh.dialog}
      <div className="proc-bar" data-testid="proc-bar">
        <div className="proc-sub small">
          {date ? fmtDate(date) : 'No date'} · {left ? <span className="missing">{left} missing</span> : <span className="ok-text">✓ Nothing missing</span>}
        </div>
        <div className="done-row small">
          <span className="muted strong">DONE:</span>
          {ticked.length ? (
            ticked.map((x) => (
              <span key={x.id} className="chip c-neutral">
                {x.label}
              </span>
            ))
          ) : (
            <span className="muted">nothing ticked yet</span>
          )}
          {!ed.readOnly && (
            <button type="button" className="link small push-end" onClick={() => setEditTicks((x) => !x)} data-testid="edit-ticks">
              {editTicks ? 'Close' : 'Edit'}
            </button>
          )}
        </div>
        <div className="proc-tabs" role="tablist" aria-label="Parts of the procedure">
          {tabs.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => jump(x.id)}>
              {x.label}
              {x.missing > 0 && <span className="tab-badge">{x.missing}</span>}
            </button>
          ))}
        </div>
      </div>

      {(editTicks || !ticked.length) && (
      <div className="group" data-field="EP_PROCEDURES.primary_procedure_type" data-testid="what-was-done">
        <div className="frow stack">
          {(['Ablation', 'Devices', 'Other'] as const).map((g) => (
            <div key={g}>
              <div className="item-group">{g}</div>
              <div className="pill-set" role="group" aria-label={g}>
                {PROCEDURE_ITEMS.filter((x) => x.group === g).map((x) => (
                  <button key={x.id} type="button" aria-pressed={ticked.includes(x)} className={ticked.includes(x) ? 'on' : ''} disabled={ed.readOnly} onClick={() => toggleItem(x)}>
                    {x.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <span className="hint" data-testid="procedure-type">
            {ptype ? `Procedure type: ${label('EP_PROCEDURES', 'primary_procedure_type', String(ptype))} — set from your ticks.` : 'Tick what was done; each item opens its own section below.'}
          </span>
        </div>
      </div>
      )}

      <Part id="part-general" title="Procedure details" missing={missDetails} {...partProps('part-general')}>
        <RowForm ed={ed} entity="EP_PROCEDURES" rowId={id} row={p} skip={MAPPING} />
        {showsDevice(types) && <DeviceSection ed={ed} leads={showsLeads(types)} offer={deviceOffer} onOpen={(e, rid) => setOpen({ entity: e, id: rid })} />}
      </Part>
      <Part id="part-mapping" title="Mapping & access" missing={missMapping} {...partProps('part-mapping')}>
        <RowForm ed={ed} entity="EP_PROCEDURES" rowId={id} row={p} only={MAPPING} />
      </Part>

      {shown.map((m) => {
        const row = moduleRow(m.entity);
        const rid = row?._id ?? ed.slot(m.entity, id);
        return (
          <Part key={m.entity} id={`part-${m.entity}`} title={m.label} missing={missingOf((x) => x.entity === m.entity)} testId={`module-${m.entity}`} {...partProps(`part-${m.entity}`)}>
            <RowForm ed={ed} entity={m.entity} rowId={rid} parentId={id} row={row} />
            {row && <NestedLists ed={ed} parentEntity={m.entity} parentId={rid} onOpen={(e, cid) => setOpen({ entity: e, id: cid })} />}
          </Part>
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

      <Part id="part-complications" title="Complications" missing={missComplications} {...partProps('part-complications')}>
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
      </Part>

      {!ed.readOnly && (
        <button
          className="btn danger-text block"
          onClick={() => {
            ed.removeWithUndo([{ entity: 'EP_PROCEDURES', id }], `${procedureTitle(p, i)} removed`);
            onClose();
          }}
        >
          <Icon name="trash" size={18} /> Remove this procedure
        </button>
      )}

      {!ed.readOnly && (
        <NextMissing
          items={missingHere}
          parts={['part-general', 'part-mapping', ...shown.map((m) => `part-${m.entity}`), 'part-complications']}
          partOf={partOf}
          openPart={(pid) => setClosedParts((x) => x.filter((y) => y !== pid))}
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
            for (const cid of confirm.componentIds) ed.removeRow('PROCEDURE_COMPONENTS', cid);
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
    <Sheet title="What's missing?" closeLabel="Close" onClose={onClose} onDone={onClose} testId="ready-sheet">
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

/** R4-8: core items per case-page section, from the same readiness checks (no second rules engine). */
function CompletenessSheet({ ed, procs, sub, onGo, onClose }: { ed: CaseEditor; procs: { id: string; label: string }[]; sub: string; onGo: (i: Issue) => void; onClose: () => void }) {
  const { readiness: r } = useCase();
  const { rows, totals: t } = completenessBySection(dict.layout.groups, r.checks, procs);
  const fix = (x: CompletenessRow) => x.fix && onGo({ text: x.fix.label, entity: x.fix.entity, field: x.fix.field, procedure_id: x.fix.procedure_id, section: x.fix.section });
  return (
    <Sheet title="Completeness" closeLabel="Close" onClose={onClose} onDone={onClose} testId="completeness-sheet">
      <div className="cmp-head">
        <b>MRN {ed.detail?.meta.mrn}</b>
        <span className="muted small">{sub}</span>
      </div>
      <div className="cmp-tiles">
        <div className="cmp-tile" data-testid="cmp-answered">
          <span className="muted small">Core items answered</span>
          <span className="cmp-num">
            {t.recorded + t.not_available} <small>of {t.applicable}</small>
          </span>
          <span className="muted small">
            {t.recorded} recorded + {t.not_available} not available
          </span>
        </div>
        <div className="cmp-tile" data-testid="cmp-recorded">
          <span className="muted small">Values recorded</span>
          <span className="cmp-num">
            {t.recorded} <small>of {t.applicable}</small>
          </span>
          <span className="muted small">not available is not a value</span>
        </div>
      </div>
      <div className="cmp-table" role="table" aria-label="Completeness by section">
        <div className="cmp-row cmp-th" role="row">
          <span role="columnheader">Section</span>
          <span role="columnheader" title="Recorded">Rec</span>
          <span role="columnheader" title="Not available">N/A</span>
          <span role="columnheader" title="Missing">Miss</span>
          <span role="columnheader" title="AI value waiting for review">AI</span>
          <span role="columnheader" aria-label="Action" />
        </div>
        {rows.map((x) => (
          <div key={x.key} className="cmp-row" role="row" data-testid={`cmp-${x.key}`}>
            <span className="cmp-label" role="cell">
              {x.label}
            </span>
            {x.applicable === 0 ? (
              <span className="cmp-none muted small" role="cell">
                No core items here
              </span>
            ) : (
              <>
                <span role="cell">{x.recorded}</span>
                <span role="cell" className="muted">
                  {x.not_available}
                </span>
                <span role="cell" className={x.missing ? 'cmp-miss' : 'muted'}>
                  {x.missing}
                </span>
                <span role="cell" className={x.ai_pending ? 'cmp-ai' : 'muted'}>
                  {x.ai_pending}
                </span>
              </>
            )}
            <span role="cell">
              {x.fix ? (
                <button type="button" className="btn small cmp-fix" onClick={() => fix(x)}>
                  Fix
                </button>
              ) : x.applicable ? (
                <span className="ok-text" aria-label="complete">
                  ✓
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      <p className="note">Same rules as "What's missing?". N/A = not available with a reason. AI = filled by the AI, not yet accepted (not counted as answered). Items a rule hides are left out.</p>
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
  move: ['MOVED', ''],
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
                  <button type="button" role="radio" aria-checked={!ev} className={!ev ? 'on' : ''} disabled={ed.readOnly} onClick={() => ev && ed.removeWithUndo([{ entity: 'OUTCOME_EVENTS', id: ev._id }], `${name} removed`)}>
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
    </>
  );
}

/** One follow-up visit: main fields first, quick events, then More fields and other events. */
function FollowUpRowSheet({ ed, id, onClose }: { ed: CaseEditor; id: string; onClose: () => void }) {
  const row = ed.rows('FOLLOW_UPS').find((r) => r._id === id) ?? null;
  const [open, setOpen] = useState<string | null>(null);
  const fresh = useNewRow(ed, 'FOLLOW_UPS', id, 'follow-up', onClose);
  if (open) return <RowSheet ed={ed} entity="OUTCOME_EVENTS" id={open} onClose={() => setOpen(null)} />;
  const same = row ? ed.rows('FOLLOW_UPS').filter((r) => r.procedure_id === row.procedure_id) : [];
  const primary = FU.primary_fields ?? [];
  const more = formFields(FU).map((f) => f.name).filter((n) => !primary.includes(n));
  const events = row ? ed.rows('OUTCOME_EVENTS').filter((e) => e[QUICK.fk] === id) : [];
  return (
    <Sheet title={row ? followUpTitle(row, same.indexOf(row)) : 'Follow-up'} onClose={fresh.cancel} onDone={fresh.done} testId="followup-sheet">
      {fresh.dialog}
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
            <button
              className="btn danger-text block"
              onClick={() => {
                ed.removeWithUndo([{ entity: 'FOLLOW_UPS', id }], 'Follow-up removed');
                onClose();
              }}
            >
              <Icon name="trash" size={18} /> Remove this follow-up
            </button>
          )}
        </>
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

/** R3-3: CHA₂DS₂-VASc as one read-only line inside Baseline risk profile; computed from saved fields, never stored. */
function ChaLine({ cha }: { cha: ChaResult }) {
  const missing = cha.items.filter((i) => i.points === null).map((i) => i.label);
  return (
    <div className="group" style={{ marginTop: 10 }}>
      <div className="frow inline" data-testid="cha-line">
        <span className="lab">
          CHA₂DS₂-VASc <span className="muted small">(calculated)</span>
        </span>
        <span className="ios-value">
          <b>{cha.score ?? 'incomplete'}</b>
        </span>
        {missing.length > 0 && <span className="hint">Not known yet: {missing.join(', ')}</span>}
      </div>
    </div>
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
  | { kind: 'report' }
  | { kind: 'followup' }
  | { kind: 'procedure'; id: string; focus?: string }
  | { kind: 'section'; title: string; entities: string[]; values?: Record<string, string>; focus?: string }
  | { kind: 'addproc' }
  | { kind: 'additional' }
  | { kind: 'ready' }
  | { kind: 'completeness' }
  | { kind: 'history' }
  | { kind: 'ai' }
  | { kind: 'cohorts' }
  | { kind: 'move' }
  | null;

export function CaseView({ id, nav, wide }: { id: string; nav: (p: string) => void; wide: boolean }) {
  const ed = useCaseEditor(id);
  const { can, me } = useAuth();
  const { toast, refreshCases, groups } = useStore();
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const cohorts = useCohorts();
  const online = useOnline();
  const [na, setNa] = useState<{ entity: string; field: string; pid: string | null } | null>(null);
  const [reopening, setReopening] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = ed.detail;

  // Owner step 8: deleted at once, with Undo (the person who deleted it may restore it within a minute).
  const deleteCase = async () => {
    if (!d) return;
    const caseId = d.meta.case_id;
    await ed.flush();
    try {
      await api('POST', `/api/cases/${caseId}/delete`, {});
      await refreshCases();
      nav('cases');
      toast({
        message: `Case ${d.meta.mrn} moved to the recycle bin`,
        undo: () =>
          void api('POST', `/api/cases/${caseId}/restore`, {})
            .then(() => refreshCases())
            .then(() => nav(`cases/${caseId}`))
            .catch((e: Error) => toast({ message: e.message, kind: 'error' })),
      });
    } catch (e) {
      toast({ message: (e as Error).message, kind: 'error' });
    }
  };

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
  // L3: Complete, Delete, AI, PDF, cohorts need the connection and a case that is already in the Google Sheet.
  const localOnly = sync.isLocalOnly(d.meta.case_id);
  const serverCase = online && !localOnly;
  const aiWaiting = aiPending(d);
  const addProcedure = () => setSheet({ kind: 'addproc' });
  const countOf = (r: LayoutRow) => {
    let n = 0;
    for (const e of r.entities) {
      const def = dict.entities[e];
      if (def.cardinality === 'multi') n += ed.rows(e).filter((x) => rowInSection(r, x)).length;
      else n += filledCount(e, ed.rows(e)[0]);
    }
    return n;
  };
  const missing = readiness.blockers.length;
  const pilgrim = ed.rows('EP_EPISODES')[0]?.pilgrim_status;
  const hajj = pilgrim === 'HAJJ' ? 'Hajj' : pilgrim === 'UMRAH' ? 'Umrah' : null;
  // The procedure's real name (owner, 28 Oct): "AF + Flutter Ablation", "Diagnostic EPS", "Device implant".
  const procName = (p: DecodedRow) => {
    const codes = comps.filter((c) => c.procedure_id === p._id).map((c) => String(c.component_type));
    const type = (p.primary_procedure_type as string) ?? null;
    const ch = procedureChip({ id: p._id, start: null, status: null, type, components: codes });
    const text = type !== 'ABLATION' && codes.length ? codes.map((c) => label('PROCEDURE_COMPONENTS', 'component_type', c)).join(' + ') : ch.text;
    return { ...ch, text };
  };
  const pathway = devicePathway(
    String(ed.rows('DEVICES')[0]?.current_device_type ?? ''),
    procs.map((p) => ({ type: (p.primary_procedure_type as string) ?? null, components: comps.filter((c) => c.procedure_id === p._id).map((c) => String(c.component_type)) })),
  );
  // Save draft (owner, 28 Oct): sends what is waiting and goes back to the list; the case stays In progress.
  const saveDraft = async () => {
    await ed.flush();
    toast({ message: 'Draft saved. The case stays In progress.', kind: 'success' });
    refreshCases();
    nav('cases');
  };
  const statusLabel = (code: unknown) => (code ? `Procedure: ${label('EP_PROCEDURES', 'procedure_status', String(code))}` : null);

  const go = (i: Issue) => {
    const focus = `${i.entity}.${i.field}`;
    if (i.procedure_id) setSheet({ kind: 'procedure', id: i.procedure_id, focus });
    else {
      const row = dict.layout.groups.flatMap((g) => g.rows).find((r) => r.id === i.section);
      if (row) setSheet({ kind: 'section', title: row.title ?? row.label, entities: row.entities, values: row.values, focus });
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
              <Icon name="back" size={22} /> Cases
            </a>
          ) : (
            <span />
          )}
          <span className="title">MRN {d.meta.mrn}</span>
          <span className="right">{!completed && <SaveIndicator />}</span>
        </div>

        <div className="hcard" data-testid="case-head">
          <div className="hc-top">
            {/* Owner, step 5: the MRN opens the patient page (no Patients tab). */}
            <a className="hc-mrn" href={`#/patients/${encodeURIComponent(d.meta.mrn)}`} title="Open the patient page" data-testid="mrn-link">
              {d.meta.mrn}
            </a>
            {ageSex(head?.age ?? null, head?.sex ?? null) && <span className="muted">{ageSex(head?.age ?? null, head?.sex ?? null)}</span>}
            {hajj && (
              <span className="chip c-cat hajj-mark" style={{ '--chip': 'var(--cat-pilgrim)' } as CSSProperties}>
                {hajj}
              </span>
            )}
          </div>
          {procs.length > 0 && (
            <div className="chips hc-chips">
              {procs.map((p) => {
                const ch = procName(p);
                return (
                  <span key={p._id} className={`chip ${ch.cls}`} style={ch.color ? ({ '--chip': `var(--${ch.color})` } as CSSProperties) : undefined}>
                    {ch.text}
                  </span>
                );
              })}
              <PathwayTag pathway={pathway} />
            </div>
          )}
          <div className="hc-meta small">
            <span className="muted">
              <span className="gdot" style={{ background: `var(--${groupColor(groups, d.meta.group_id)})` }} aria-hidden />
              {d.meta.group_name} · {seqText(d.meta.group_seq)}
              {head?.start ? ` · ${fmtDate(head.start)}` : ''}
              {head?.end ? ` → ${fmtDate(head.end)}` : ''}
            </span>
            <span className={`status ${completed ? 's-done' : 's-prog'}`} data-testid="case-status">
              {completed ? 'Completed' : 'In progress'}
            </span>
            {!completed && (
              <span className={missing ? 'missing' : 'ok-text'} data-testid="core-progress" title={`Core fields: ${readiness.done} of ${readiness.total} done`}>
                {missing ? `${missing} missing` : '✓ Nothing missing'}
              </span>
            )}
            {localOnly && (
              <span className="chip c-neutral" data-testid="device-only">
                On this device only
              </span>
            )}
          </div>
        </div>

        <div className="tools-row" data-testid="case-tools">
          {can('ai.extract') && !completed && me?.features?.ai !== false && (
            <button className="tool" onClick={() => setSheet({ kind: 'ai' })} data-testid="ai-row" disabled={!serverCase} aria-label="AI Assistant: fill from a clinical note" title="AI Assistant: fill from a clinical note">
              <Icon name="extract" size={22} />
              <span>AI</span>
            </button>
          )}
          {(cohorts.length > 0 || can('cohorts.manage')) && (
            <button className="tool" onClick={() => setSheet({ kind: 'cohorts' })} data-testid="cohorts-row" disabled={!serverCase}>
              <Icon name="patients" size={22} />
              <span>Cohorts{(d.summary.cohorts ?? []).length ? ` (${(d.summary.cohorts ?? []).length})` : ''}</span>
            </button>
          )}
          <button className="tool" onClick={() => setSheet({ kind: 'completeness' })} data-testid="completeness-row" aria-label="Completeness by section">
            <Icon name="bars" size={22} />
            <span>Completeness</span>
          </button>
          <button className="tool" onClick={() => setSheet({ kind: 'history' })} data-testid="history-row" title={`${d.history_count} change${d.history_count === 1 ? '' : 's'}`}>
            <Icon name="cal" size={22} />
            <span>History</span>
          </button>
          {can('report.pdf') && (
            <button className="tool" onClick={() => setSheet({ kind: 'report' })} data-testid="report-row" disabled={!serverCase} aria-label="Case report (PDF)">
              <Icon name="doc" size={22} />
              <span>Report</span>
            </button>
          )}
          {can('case.reassign') && groups.length > 1 && (
            <button className="tool" onClick={() => setSheet({ kind: 'move' })} data-testid="move-row" disabled={!serverCase || !online} aria-label="Move to another group">
              <Icon name="refresh" size={22} />
              <span>Move</span>
            </button>
          )}
        </div>

        {completed && (
          <div className="banner done" data-testid="completed-banner">
            <Icon name="check" size={18} />
            <span className="grow">
              Completed{d.meta.completed_by_name ? ` by ${d.meta.completed_by_name}` : ''}
              {d.meta.completed_at ? ` on ${fmtDate(d.meta.completed_at.slice(0, 10))}` : ''}. Read only.
            </span>
            {can('case.reopen') && (
              <button className="btn small" onClick={() => setReopening(true)} disabled={!online} title={online ? undefined : 'Needs the connection'}>
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
        {!procs.length && !completed ? (
          <button className="add-first" onClick={addProcedure} data-testid="add-procedure">
            <Icon name="plus" size={30} />
            Add procedure
          </button>
        ) : (
          <div className="group" data-testid="procedures">
            {procs.map((p, i) => {
              const t = readiness.byProcedure[p._id];
              const left = t ? t.total - t.done : 0;
              const date = p.procedure_start_datetime ? String(p.procedure_start_datetime).slice(0, 10) : null;
              const status = statusLabel(p.procedure_status);
              return (
                <button key={p._id} className="grow-row" onClick={() => setSheet({ kind: 'procedure', id: p._id })} data-testid="procedure-row" aria-label={procedureTitle(p, i)}>
                  <span className="grow">
                    <span className="line1 proc-top">
                      <b>{procName(p).text}</b>
                      <span className="proc-date">{date ? fmtDate(date) : 'No date'}</span>
                    </span>
                    <span className="sub">
                      {status ? `${status} · ` : ''}
                      {left > 0 ? <span className="missing">{left} missing</span> : t?.total ? <span className="ok-text">✓ Complete</span> : 'No details yet'}
                    </span>
                  </span>
                  <Icon name="chevron" size={16} className="muted" />
                </button>
              );
            })}
            {!completed && (
              <button className="grow-row add" onClick={addProcedure} data-testid="add-procedure">
                <span className="row-ic">
                  <Icon name="plus" size={20} />
                </span>
                Add procedure
              </button>
            )}
            {completed && !procs.length && <div className="grow-row muted">No procedures</div>}
          </div>
        )}

        {dict.layout.groups.map((g) => (
          <div key={g.id}>
            <h2 className="sechead">{g.label}</h2>
            <div className="group">
              {g.rows.map((r) => {
                const later = r.entities.map((e) => dict.entities[e].later).find(Boolean);
                const t = readiness.bySection[r.id];
                const n = countOf(r);
                const state = later ? (
                  <span className="muted small">Comes in {later}</span>
                ) : t?.total && t.done < t.total ? (
                  <span className="missing small">{t.total - t.done} missing</span>
                ) : t?.total ? (
                  <span className="ok-text" aria-label="complete">
                    ✓
                  </span>
                ) : n ? (
                  <span className="muted small">{n}</span>
                ) : (
                  <span className="add-text small">{completed ? '—' : 'Add'}</span>
                );
                return (
                  <button
                    key={r.id}
                    className="grow-row"
                    disabled={!!later}
                    onClick={() => setSheet(r.id === 'followup' ? { kind: 'followup' } : { kind: 'section', title: r.title ?? r.label, entities: r.entities, values: r.values })}
                    data-testid={`section-${r.id}`}
                  >
                    <span className="row-ic">
                      <Icon name={r.icon} size={22} />
                    </span>
                    <span className="grow">{r.label}</span>
                    {state}
                    {!later && <Icon name="chevron" size={16} className="muted" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <h2 className="sechead">Notes</h2>
        <div className="group">
          <button className="grow-row add" onClick={() => setSheet({ kind: 'additional' })} disabled={completed && !d.additional.length}>
            <span className="row-ic">
              <Icon name={d.additional.length ? 'edit' : 'plus'} size={20} />
            </span>
            {d.additional.length ? `${d.additional.length} note${d.additional.length === 1 ? '' : 's'}` : completed ? 'None' : 'Add note'}
          </button>
        </div>

        {!completed && !serverCase && (
          <p className="muted small center" data-testid="needs-connection">
            Complete, Delete, AI and PDF need the connection.
          </p>
        )}

        {can('case.delete') && !completed && (
          <button className="btn danger-text block delete-case" onClick={deleteCase} disabled={!serverCase}>
            <Icon name="trash" size={18} /> Delete case
          </button>
        )}

        {!completed && procs.length > 0 && (
          <div className="bottomact" data-testid="complete-bar">
            <button className="btn draft-btn" onClick={saveDraft} disabled={busy} data-testid="save-draft">
              Save draft
            </button>
            <button className="btn grow" onClick={() => setSheet({ kind: 'ready' })} data-testid="whats-missing">
              {missing ? `What's missing? (${missing})` : "What's missing?"}
            </button>
            {can('case.complete') && (
              <button className="btn primary" disabled={!readiness.canComplete || busy || ed.pending > 0 || !serverCase} onClick={complete}>
                Complete
              </button>
            )}
          </div>
        )}

        {sheet?.kind === 'procedure' && <ProcedureSheet ed={ed} id={sheet.id} focus={sheet.focus} onClose={() => setSheet(null)} />}
        {sheet?.kind === 'section' && <SectionSheet ed={ed} title={sheet.title} entities={sheet.entities} values={sheet.values} focus={sheet.focus} cha={cha} onClose={() => setSheet(null)} />}
        {sheet?.kind === 'addproc' && <AddProcedureSheet ed={ed} onClose={() => setSheet(null)} onNext={(pid) => setSheet({ kind: 'procedure', id: pid })} />}
        {sheet?.kind === 'additional' && <AdditionalSheet ed={ed} onClose={() => setSheet(null)} />}
        {sheet?.kind === 'followup' && <FollowUpSheet ed={ed} onClose={() => setSheet(null)} />}
        {sheet?.kind === 'report' && <ReportSheet ed={ed} readiness={readiness} onClose={() => setSheet(null)} />}
        {sheet?.kind === 'ready' && <ReadySheet ed={ed} busy={busy} onGo={go} onComplete={complete} onClose={() => setSheet(null)} />}
        {sheet?.kind === 'completeness' && (
          <CompletenessSheet
            ed={ed}
            procs={procs.map((p, i) => ({ id: p._id, label: procs.length > 1 ? `${i + 1}. ${procName(p).text}` : procName(p).text }))}
            sub={[`${d.meta.group_name} · ${seqText(d.meta.group_seq)}`, completed ? 'Completed' : 'In progress', ...procs.map((p) => procName(p).text)].join(' · ')}
            onGo={go}
            onClose={() => setSheet(null)}
          />
        )}
        {sheet?.kind === 'ai' && <AiSheet ed={ed} procs={procs.map((p) => ({ id: p._id, title: procHeading(ed, p._id) }))} onClose={() => setSheet(null)} />}
        {sheet?.kind === 'history' && <HistorySheet caseId={d.meta.case_id} onClose={() => setSheet(null)} />}
        {sheet?.kind === 'move' && (
          <MoveCaseSheet caseId={d.meta.case_id} mrn={d.meta.mrn} groupId={d.meta.group_id} seq={d.meta.group_seq} onMoved={() => Promise.all([ed.reload(), refreshCases()])} onClose={() => setSheet(null)} />
        )}
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
      </section>
    </CaseContext.Provider>
  );
}

export { displayValue };
