// Patients (kept from EP Case Log, owner D6): one entry per MRN, built from the cases the user can see.
import { useMemo, useState } from 'react';
import type { CaseSummary } from '../../shared/caseTypes.ts';
import { ageSex, fmtDate } from '../lib/util';
import { useStore } from '../store';
import { Icon } from '../components/Icon';
import { Empty } from '../components/ui';
import { CaseRow } from './CasesView';

export function PatientsView({ mrn, nav }: { mrn?: string; nav: (p: string) => void }) {
  const { cases, groups } = useStore();
  const [q, setQ] = useState('');
  const patients = useMemo(() => {
    const m = new Map<string, CaseSummary[]>();
    for (const c of cases) m.set(c.mrn, [...(m.get(c.mrn) ?? []), c]);
    return [...m.entries()]
      .map(([k, cs]) => {
        const sorted = [...cs].sort((a, b) => (b.episode_start_date ?? '').localeCompare(a.episode_start_date ?? ''));
        return { mrn: k, cases: sorted, last: sorted[0] };
      })
      .sort((a, b) => (b.last.episode_start_date ?? '').localeCompare(a.last.episode_start_date ?? ''));
  }, [cases]);
  const gname = (id: string) => groups.find((g) => g.group_id === id)?.name ?? '';

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
    const procs = p.cases.reduce((n, c) => n + c.procedures.length, 0);
    return (
      <section className="view" aria-label="Patient">
        <div className="navbar">
          <a href="#/patients" className="back link">
            <Icon name="back" size={22} /> Patients
          </a>
        </div>
        <h1 className="large-title">MRN {p.mrn}</h1>
        <div className="hcard">
          <div>{ageSex(p.last.age, p.last.sex) || 'Age and sex not recorded'}</div>
          <div className="muted small">
            {p.cases.length} case{p.cases.length === 1 ? '' : 's'} · {procs} procedure{procs === 1 ? '' : 's'}
            {p.last.episode_start_date ? ` · last episode ${fmtDate(p.last.episode_start_date)}` : ''}
          </div>
        </div>
        <h2 className="sechead">Cases you can see</h2>
        <div className="group">
          {p.cases.map((c) => (
            <CaseRow key={c.case_id} c={c} showGroup={gname(c.group_id)} />
          ))}
        </div>
      </section>
    );
  }

  const term = q.replace(/\s+/g, '');
  const filtered = patients.filter((p) => !term || p.mrn.includes(term));
  return (
    <section className="view" aria-label="Patients">
      <h1 className="large-title">Patients</h1>
      <div className="search">
        <Icon name="search" size={18} />
        <input type="search" inputMode="numeric" placeholder="Search MRN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search patients" />
      </div>
      {patients.length === 0 ? (
        <Empty icon="patients" title="No patients yet">
          <p>Patients appear here from the MRNs of the cases you can see.</p>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty icon="search" title="No matching patients" />
      ) : (
        <div className="group" style={{ marginTop: 16 }}>
          {filtered.map((p) => (
            <a key={p.mrn} href={`#/patients/${encodeURIComponent(p.mrn)}`} className="grow-row" data-testid="patient-row">
              <span className="grow">
                <span className="line1">
                  <b>{p.mrn}</b> <span className="muted">{ageSex(p.last.age, p.last.sex)}</span>
                </span>
                <span className="sub">
                  {p.cases.length} case{p.cases.length === 1 ? '' : 's'}
                  {p.last.episode_start_date ? ` · last ${fmtDate(p.last.episode_start_date)}` : ''}
                </span>
              </span>
              <Icon name="chevron" size={16} className="muted" />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
