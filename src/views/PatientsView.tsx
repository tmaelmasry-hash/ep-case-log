import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { caseCha } from '../lib/cha';
import type { CaseRec } from '../lib/types';
import { fmtDate } from '../lib/util';
import { Icon } from '../components/Icon';
import { Empty } from '../components/ui';
import { CaseRow } from './CasesView';

interface PatientSummary {
  mrn: string;
  cases: CaseRec[];
  last: CaseRec;
}

export function PatientsView({ mrn, nav }: { mrn?: string; nav: (p: string) => void }) {
  const { cases, images } = useStore();
  const [q, setQ] = useState('');

  const patients = useMemo(() => {
    const m = new Map<string, CaseRec[]>();
    for (const c of cases) m.set(c.mrn, [...(m.get(c.mrn) ?? []), c]);
    return [...m.entries()]
      .map(([k, cs]): PatientSummary => {
        const sorted = cs.sort((a, b) => b.date.localeCompare(a.date));
        return { mrn: k, cases: sorted, last: sorted[0] };
      })
      .sort((a, b) => b.last.date.localeCompare(a.last.date));
  }, [cases]);

  const imgCount = (id: string) => images.filter((i) => i.caseId === id).length;

  if (mrn) {
    const p = patients.find((x) => x.mrn === mrn);
    if (!p)
      return (
        <section className="view">
          <Empty icon="patients" title="Patient not found">
            <button className="btn" onClick={() => nav('patients')}>
              Back to patients
            </button>
          </Empty>
        </section>
      );
    const latestCha = p.cases.map(caseCha).find(Boolean);
    return (
      <section className="view" aria-label="Patient">
        <div className="toolbar">
          <a href="#/patients" className="link back">
            <Icon name="back" size={20} /> Patients
          </a>
        </div>
        <h1 className="large-title">MRN {p.mrn}</h1>
        <div className="card head-card">
          <p>
            {p.last.sex ? (p.last.sex === 'M' ? 'Male' : 'Female') : 'Sex not recorded'}
            {p.last.age != null && ` · ${p.last.age} y at last case`}
          </p>
          <p className="muted small">
            {p.cases.length} case{p.cases.length === 1 ? '' : 's'} · first {fmtDate(p.cases[p.cases.length - 1].date)} · last {fmtDate(p.last.date)}
          </p>
          {latestCha && <p className="small">Most recent CHA₂DS₂-VASc: {latestCha.score}</p>}
        </div>
        <h2 className="section-label">Cases</h2>
        <div className="card list">
          {p.cases.map((c) => (
            <CaseRow key={c.id} c={c} imageCount={imgCount(c.id)} />
          ))}
        </div>
      </section>
    );
  }

  const filtered = patients.filter((p) => !q.trim() || p.mrn.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <section className="view" aria-label="Patients">
      <h1 className="large-title">Patients</h1>
      <div className="search">
        <Icon name="search" size={18} />
        <input type="search" placeholder="Search MRN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search patients" />
      </div>
      {patients.length === 0 ? (
        <Empty icon="patients" title="No patients yet">
          <p>Patients appear here automatically from the MRNs on your cases.</p>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty icon="search" title="No matching patients" />
      ) : (
        <div className="card list">
          {filtered.map((p) => (
            <a key={p.mrn} href={`#/patients/${encodeURIComponent(p.mrn)}`} className="row" data-testid="patient-row">
              <div className="row-main">
                <div className="row-title">
                  <b>{p.mrn}</b>
                  <span className="muted">{`${p.last.age ?? ''}${p.last.sex}`}</span>
                </div>
                <div className="muted small">
                  {p.cases.length} case{p.cases.length === 1 ? '' : 's'} · last {fmtDate(p.last.date)}
                </div>
              </div>
              <Icon name="chevron" size={18} className="muted" />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
