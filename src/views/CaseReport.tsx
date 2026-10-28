// Case report (owner D6): the saved values of one case with their dictionary labels, in the case page order.
// Saved values only — no generated wording. Printed by the browser (Print → Save as PDF).
import { createPortal } from 'react-dom';
import { displayValue, formFields, hasValue, rowInSection } from '../../shared/dictionary.ts';
import type { CaseDetail, DecodedRow } from '../../shared/caseTypes.ts';
import { cha2ds2vasc, chaRelevant } from '../../shared/cha.ts';
import type { Readiness } from '../../shared/readiness.ts';
import { dict, fieldOf, label } from '../lib/dict';
import { fmtDate } from '../lib/util';

/** Never printed: the research study's own patient ID is an identifier (EP Workspace M-3 F2). */
const NOT_PRINTED = new Set(['PATIENTS.research_study_patient_id']);

function Values({ entity, row }: { entity: string; row: DecodedRow }) {
  const def = dict.entities[entity];
  const shown = formFields(def).filter((f) => hasValue(row[f.name]) && !NOT_PRINTED.has(`${entity}.${f.name}`));
  if (!shown.length) return null;
  return (
    <table className="kv">
      <tbody>
        {shown.map((f) => (
          <tr key={f.name}>
            <th>{f.label}</th>
            <td>
              {displayValue(f, row[f.name])}
              {(row.other_specify_json as Record<string, string> | null)?.[f.name] ? ` — ${(row.other_specify_json as Record<string, string>)[f.name]}` : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Rows({ entity, rows, rowsOf }: { entity: string; rows: DecodedRow[]; rowsOf: Record<string, DecodedRow[]> }) {
  const def = dict.entities[entity];
  const nested = Object.values(dict.entities).filter((d) => d.nest_under?.entity === entity);
  return (
    <>
      {rows.map((r, i) => (
        <div key={r._id} className="report-block">
          <h3>{def.cardinality === 'multi' ? `${def.label} ${i + 1}` : def.label}</h3>
          <Values entity={entity} row={r} />
          {nested.map((n) => (
            <Rows key={n.entity} entity={n.entity} rows={(rowsOf[n.entity] ?? []).filter((k) => k[n.nest_under!.fk] === r._id)} rowsOf={rowsOf} />
          ))}
        </div>
      ))}
    </>
  );
}

export function CaseReport({ d, rows, readiness }: { d: CaseDetail; rows: (entity: string) => DecodedRow[]; readiness: Readiness }) {
  const all = Object.fromEntries(Object.keys(dict.entities).map((e) => [e, rows(e)]));
  const cha = chaRelevant(all) ? cha2ds2vasc(all) : null;
  const procs = rows('EP_PROCEDURES');
  const na = readiness.checks.filter((c) => c.state === 'not_available');
  const caseGroups = dict.layout.groups;
  const procEntities = Object.values(dict.entities).filter((e) => e.scope === 'procedure' && !['PROCEDURE_COMPONENTS'].includes(e.entity));
  return (
    <article className="report" data-testid="case-report">
      <header>
        <h1>KAMC EP Registry — Case report</h1>
        <div>
          MRN {d.meta.mrn} · {d.meta.group_name} No. {d.meta.group_seq} · {d.meta.collection_status === 'COMPLETED' ? 'Completed' : 'In progress'} · core fields {readiness.done} of {readiness.total}
        </div>
        {cha && <div>CHA₂DS₂-VASc: {cha.score === null ? `incomplete (${cha.missing.join(', ')} not known)` : cha.score}</div>}
      </header>

      {caseGroups.map((g) =>
        g.rows.map((r) => {
          const mine = (e: string) => rows(e).filter((x) => rowInSection(r, x));
          const parts = r.entities.filter((e) => dict.entities[e].scope !== 'procedure' && mine(e).length);
          if (!parts.length) return null;
          return (
            <section key={r.id}>
              <h2>{r.label}</h2>
              {parts.map((e) => (
                <Rows key={e} entity={e} rows={mine(e)} rowsOf={all} />
              ))}
            </section>
          );
        }),
      )}

      {procs.map((p, i) => {
        const comps = rows('PROCEDURE_COMPONENTS').filter((c) => c.procedure_id === p._id).map((c) => label('PROCEDURE_COMPONENTS', 'component_type', String(c.component_type)));
        return (
          <section key={p._id} className="report-proc">
            <h2>
              Procedure {i + 1}
              {p.primary_procedure_type ? ` · ${label('EP_PROCEDURES', 'primary_procedure_type', String(p.primary_procedure_type))}` : ''}
              {comps.length ? ` (${comps.join(' + ')})` : ''}
            </h2>
            <Values entity="EP_PROCEDURES" row={p} />
            {procEntities.map((e) => {
              const list = rows(e.entity).filter((r) => r.procedure_id === p._id);
              return list.length ? <Rows key={e.entity} entity={e.entity} rows={list} rowsOf={all} /> : null;
            })}
          </section>
        );
      })}

      {d.additional.length > 0 && (
        <section>
          <h2>Additional clinical information</h2>
          <ul>
            {d.additional.map((a) => (
              <li key={a.info_id}>
                {a.text}
                {a.fact_date ? ` (${fmtDate(a.fact_date)})` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      {na.length > 0 && (
        <section>
          <h2>Not available</h2>
          <table className="kv">
            <tbody>
              {na.map((c) => (
                <tr key={c.key}>
                  <th>
                    {c.procedure_id ? `Procedure ${procs.findIndex((p) => p._id === c.procedure_id) + 1} · ` : ''}
                    {fieldOf(c.entity, c.field)?.label ?? c.label}
                  </th>
                  <td>{c.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <footer>Saved values only, with the registry dictionary labels. Printed {new Date().toLocaleString('en-GB')}.</footer>
    </article>
  );
}

/** The report placed where the print stylesheet shows it (#print-root). */
export function PrintPortal(props: Parameters<typeof CaseReport>[0]) {
  const root = document.getElementById('print-root');
  return root ? createPortal(<CaseReport {...props} />, root) : null;
}
