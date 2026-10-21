import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { PROC_BY_TYPE, procLabel } from '../lib/catalog';
import { caseCha, caseNeedsCha } from '../lib/cha';
import type { CaseRec, FieldValue, ImageRec } from '../lib/types';
import { fmtDate } from '../lib/util';

function fmt(v: FieldValue | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

/** Printable case report. The browser's print dialog provides "Save as PDF". */
export function CaseReport({ c, onDone }: { c: CaseRec; onDone: () => void }) {
  const { images, getImage } = useStore();
  const [full, setFull] = useState<ImageRec[] | null>(null);
  const target = document.getElementById('print-root');

  useEffect(() => {
    const ids = images.filter((i) => i.caseId === c.id).map((i) => i.id);
    Promise.all(ids.map(getImage)).then((r) => setFull(r.filter(Boolean) as ImageRec[]));
  }, [c.id, images, getImage]);

  useEffect(() => {
    if (!full) return;
    const after = () => onDone();
    window.addEventListener('afterprint', after);
    const t = window.setTimeout(() => window.print(), 300);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('afterprint', after);
    };
  }, [full, onDone]);

  if (!target) return null;
  const cha = caseCha(c);
  const opnotes = (full ?? []).filter((i) => i.kind === 'opnote');
  const pics = (full ?? []).filter((i) => i.kind === 'image');

  return createPortal(
    <article className="report">
      <header>
        <h1>EP Case Report</h1>
        <p>Generated {new Date().toLocaleString()}</p>
      </header>
      <table className="kv">
        <tbody>
          <tr>
            <th>Date</th>
            <td>{fmtDate(c.date)}</td>
            <th>MRN</th>
            <td>{c.mrn}</td>
          </tr>
          <tr>
            <th>Age / Sex</th>
            <td>
              {c.age ?? '—'} / {c.sex || '—'}
            </td>
            <th>Role</th>
            <td>{c.role || '—'}</td>
          </tr>
          <tr>
            <th>Fluoroscopy</th>
            <td>{c.fluoroMin != null ? `${c.fluoroMin} min` : '—'}</td>
            <th>CHA₂DS₂-VASc</th>
            <td>{caseNeedsCha(c) ? (cha ? `${cha.score} (CHA₂DS₂-VA ${cha.vaScore})` : 'Not recorded') : 'N/A'}</td>
          </tr>
        </tbody>
      </table>
      {cha && cha.items.length > 0 && <p className="small">Risk factors at time of procedure: {cha.items.map((i) => `${i.label} (+${i.points})`).join('; ')}</p>}

      <h2>Procedures</h2>
      {c.procedures.length === 0 && <p>None recorded.</p>}
      {c.procedures.map((p) => (
        <section key={p.id} className="report-proc">
          <h3>{procLabel(p)}</h3>
          <table className="kv">
            <tbody>
              {(PROC_BY_TYPE[p.type]?.fields ?? []).map((f) => (
                <tr key={f.key}>
                  <th>{f.label}</th>
                  <td>
                    {fmt(p.details[f.key])}
                    {f.unit && p.details[f.key] != null ? ` ${f.unit}` : ''}
                  </td>
                </tr>
              ))}
              {p.notes && (
                <tr>
                  <th>Notes</th>
                  <td>{p.notes}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      ))}

      <h2>Complications</h2>
      <p>{c.complications.length ? c.complications.join(', ') : 'None recorded'}</p>
      {c.complicationNote && <p>{c.complicationNote}</p>}

      {c.notes && (
        <>
          <h2>Notes</h2>
          <p className="pre">{c.notes}</p>
        </>
      )}
      {opnotes.length > 0 && (
        <>
          <h2>Op Note</h2>
          {opnotes.map((i) => (
            <img key={i.id} src={i.dataUrl} alt="Op note" className="report-img full" />
          ))}
        </>
      )}
      {pics.length > 0 && (
        <>
          <h2>Images</h2>
          <div className="report-grid">
            {pics.map((i) => (
              <figure key={i.id}>
                <img src={i.dataUrl} alt={i.caption} className="report-img" />
                {i.caption && <figcaption>{i.caption}</figcaption>}
              </figure>
            ))}
          </div>
        </>
      )}
      <footer>Personal procedure log — not a medical record.</footer>
    </article>,
    target,
  );
}
