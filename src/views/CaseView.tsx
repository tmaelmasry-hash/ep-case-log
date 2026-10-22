// Case page (approved EP Log-style preview): header card, then grouped rows; each row opens its form in a sheet.
// Case = one EP_EPISODE; PROCEDURES lists the episode's EP_PROCEDURES, each with its components and modules.
import { useMemo, useState } from 'react';
import { codeLabel, displayValue, hasValue, offeredCodes, type FormField } from '../../shared/dictionary.ts';
import { ageOn, type DecodedRow } from '../../shared/caseTypes.ts';
import { dict, fieldOf, label } from '../lib/dict';
import { ageSex, fmtDate, fmtShortDate } from '../lib/util';
import { useCaseEditor, type CaseEditor } from '../caseEditor';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { Icon } from '../components/Icon';
import { Confirm, Empty, SaveIndicator, Sheet } from '../components/ui';
import { EntityFields, type FkOption } from '../components/Fields';
import { api } from '../lib/api';

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
function RowForm({ ed, entity, rowId, parentId, row }: { ed: CaseEditor; entity: string; rowId: string; parentId?: string | null; row: DecodedRow | null }) {
  const fk = useFk(ed);
  const exists = !!row;
  return (
    <EntityFields
      entity={entity}
      row={row}
      rowId={rowId}
      fkOptions={fk}
      errorOf={(field) => ed.fieldError(entity, rowId, field)}
      onChange={(field, value, key) => ed.setField(entity, rowId, field, value, { key, create: exists ? undefined : { parent_id: parentId ?? null } })}
    />
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
              <button className="grow-row add" onClick={() => onOpen(child.entity, ed.addRow(child.entity, parentId))}>
                <Icon name="plus" size={18} /> Add {child.label.toLowerCase()}
              </button>
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
          <button className="btn danger-text block" onClick={() => setConfirm(true)}>
            <Icon name="trash" size={18} /> Remove {def.label.toLowerCase()}
          </button>
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
function SectionSheet({ ed, title, entities, onClose }: { ed: CaseEditor; title: string; entities: string[]; onClose: () => void }) {
  const [open, setOpen] = useState<{ entity: string; id: string } | null>(null);
  const caseId = ed.detail!.meta.case_id;
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
              <button className="grow-row add" onClick={() => setOpen({ entity, id: ed.addRow(entity) })}>
                <Icon name="plus" size={18} /> Add {def.label.toLowerCase()}
              </button>
            </div>
          </div>
        );
      })}
    </Sheet>
  );
}

const MODULES = Object.values(dict.entities).filter((d) => d.module);

/** One procedure: its EP_PROCEDURES fields, components, the modules they call for, and its complications. */
function ProcedureSheet({ ed, id, onClose }: { ed: CaseEditor; id: string; onClose: () => void }) {
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
  const shown = MODULES.filter((m) => m.module!.some((t) => types.includes(t)) || moduleRow(m.entity) || extra.includes(m.entity));
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
              <button key={c} type="button" aria-pressed={types.includes(c)} className={types.includes(c) ? 'on' : ''} onClick={() => toggleComponent(c)}>
                {codeLabel(compField, c)}
              </button>
            ))}
          </div>
          <span className="hint">Each component opens its own section below.</span>
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
      {offer.length > 0 && (
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
      <div className="group" style={{ marginTop: 10 }}>
        {complications.map((c, k) => (
          <button key={c._id} className="grow-row" onClick={() => setOpen({ entity: 'COMPLICATIONS', id: c._id })}>
            <span className="grow">{rowTitle('COMPLICATIONS', c, k)}</span>
            <Icon name="chevron" size={16} className="muted" />
          </button>
        ))}
        <button className="grow-row add" onClick={() => setOpen({ entity: 'COMPLICATIONS', id: ed.addRow('COMPLICATIONS', id) })}>
          <Icon name="plus" size={18} /> Add complication
        </button>
      </div>

      <button className="btn danger-text block" onClick={() => setConfirm('procedure')}>
        <Icon name="trash" size={18} /> Remove this procedure
      </button>

      {confirm === 'procedure' && (
        <Confirm
          title="Remove this procedure?"
          message={`${procedureTitle(p, i)}, its components, procedure sections and complications will be removed from this case.`}
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
            <button className="icon-btn small" aria-label="Remove information" onClick={() => ed.additional('remove', a.info_id)}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))}
        {!list.length && <div className="grow-row muted">Nothing added.</div>}
      </div>
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
    </Sheet>
  );
}

type OpenSheet = { kind: 'procedure'; id: string } | { kind: 'section'; title: string; entities: string[] } | { kind: 'additional' } | null;

export function CaseView({ id, nav, wide }: { id: string; nav: (p: string) => void; wide: boolean }) {
  const ed = useCaseEditor(id);
  const { can } = useAuth();
  const { toast, refreshCases } = useStore();
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const d = ed.detail;

  const head = useMemo(() => {
    if (!d) return null;
    const ep = ed.rows('EP_EPISODES')[0];
    const ident = ed.rows('PATIENT_IDENTIFIERS')[0];
    const pat = ed.rows('PATIENTS')[0];
    const start = (ep?.episode_start_date as string) ?? null;
    return { start, end: (ep?.episode_end_date as string) ?? null, age: ageOn(ident?.date_of_birth, start), sex: (pat?.sex_at_birth as string) ?? null };
  }, [d, ed]);

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
            {ed.notFound ? 'Back to cases' : 'Try again'}
          </button>
        </Empty>
      </section>
    );
  }

  const procs = ed.rows('EP_PROCEDURES');
  const comps = ed.rows('PROCEDURE_COMPONENTS');
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

  return (
    <section className="view case-view" aria-label="Case">
      <div className="navbar">
        {!wide ? (
          <a href="#/cases" className="back link">
            <Icon name="back" size={22} /> Cases
          </a>
        ) : (
          <span />
        )}
        <span className="title">Case</span>
        <span className="right">
          <SaveIndicator />
        </span>
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
          <span className={`status ${d.meta.collection_status === 'COMPLETED' ? 's-done' : 's-prog'}`}>{d.meta.collection_status === 'COMPLETED' ? 'Completed' : 'In progress'}</span>
        </div>
      </div>

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
                <span className="sub">{sub || 'No details yet'}</span>
              </span>
              <Icon name="chevron" size={16} className="muted" />
            </button>
          );
        })}
        <button className="grow-row add" onClick={addProcedure}>
          <span className="row-ic">
            <Icon name="plus" size={20} />
          </span>
          Add Procedure
        </button>
      </div>

      {dict.layout.groups.map((g) => (
        <div key={g.id}>
          <h2 className="sechead">{g.label}</h2>
          <div className="group">
            {g.rows.map((r) => {
              const later = r.entities.map((e) => dict.entities[e].later).find(Boolean);
              return (
                <button key={r.id} className="grow-row" disabled={!!later} onClick={() => setSheet({ kind: 'section', title: r.label, entities: r.entities })} data-testid={`section-${r.id}`}>
                  <span className="row-ic">
                    <Icon name={r.icon} size={22} />
                  </span>
                  <span className="grow">{r.label}</span>
                  <span className="muted small">{later ? `Comes in ${later}` : countOf(r.entities) || '—'}</span>
                  {!later && <Icon name="chevron" size={16} className="muted" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <h2 className="sechead">Additional clinical information</h2>
      <div className="group">
        <button className="grow-row add" onClick={() => setSheet({ kind: 'additional' })}>
          <span className="row-ic">
            <Icon name={d.additional.length ? 'edit' : 'plus'} size={20} />
          </span>
          {d.additional.length ? `${d.additional.length} item${d.additional.length === 1 ? '' : 's'}` : 'Add Information'}
        </button>
      </div>

      {can('case.delete') && (
        <button className="btn danger-text block delete-case" onClick={() => setConfirmDelete(true)}>
          <Icon name="trash" size={18} /> Delete case
        </button>
      )}

      {sheet?.kind === 'procedure' && <ProcedureSheet ed={ed} id={sheet.id} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'section' && <SectionSheet ed={ed} title={sheet.title} entities={sheet.entities} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'additional' && <AdditionalSheet ed={ed} onClose={() => setSheet(null)} />}
      {confirmDelete && (
        <Confirm
          title="Delete this case?"
          message={`MRN ${d.meta.mrn} · ${d.meta.group_name} No. ${d.meta.group_seq} will go to the recycle bin. An Admin can restore it (recycle bin screen comes in phase 3).`}
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
  );
}

export { displayValue };
