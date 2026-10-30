// Patient page (kept from EP Case Log, owner D6): one MRN, built from the cases the user can see. Since step 5 there is
// no Patients tab; the page opens from the MRN in search or in a case header. It lists each procedure (owner's edit on
// the step 5 preview), with the device recorded next to the MRN.
import { useMemo, useState, type CSSProperties } from 'react';
import type { CaseSummary, ProcedureSummary } from '../../shared/caseTypes.ts';
import { ageSex, fmtDate } from '../lib/util';
import { groupColor } from '../lib/filters';
import { useStore } from '../store';
import { Icon } from '../components/Icon';
import { Empty, Segmented } from '../components/ui';
import { missingOf, procedureChip } from './CasesView';
import { deviceOf } from './Followups';
import { PatientTimeline } from './PatientTimeline';

const back = () => (window.history.length > 1 ? window.history.back() : (window.location.hash = '#/cases'));

export function PatientView({ mrn }: { mrn: string }) {
  const { cases, groups } = useStore();
  const [view, setView] = useState<'Cases' | 'Timeline'>('Cases');
  const own = useMemo(() => cases.filter((c) => c.mrn === mrn).sort((a, b) => (b.episode_start_date ?? '').localeCompare(a.episode_start_date ?? '')), [cases, mrn]);
  const gname = (id: string) => groups.find((g) => g.group_id === id)?.name ?? '';
  const backLink = (
    <div className="navbar">
      <button className="back link" onClick={back}>
        <Icon name="back" size={22} /> Back
      </button>
    </div>
  );
  if (!own.length)
    return (
      <section className="view">
        {backLink}
        <Empty icon="patients" title="Patient not found">
          <p>No case you can see has this MRN.</p>
        </Empty>
      </section>
    );
  const last = own[0];
  const device = own.map(deviceOf).find(Boolean);
  const rows = own.flatMap((c): { c: CaseSummary; p: ProcedureSummary | null; date: string | null }[] =>
    c.procedures.length ? c.procedures.map((p) => ({ c, p, date: p.start?.slice(0, 10) ?? c.episode_start_date })) : [{ c, p: null, date: c.episode_start_date }],
  );
  rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const procs = own.reduce((n, c) => n + c.procedures.length, 0);
  return (
    <section className="view" aria-label="Patient" data-testid="patient-view">
      {backLink}
      <h1 className="large-title patient-title">
        {mrn}
        {device && <span className="dev-chip">{device}</span>}
      </h1>
      <div className="hcard">
        <div>{ageSex(last.age, last.sex) || 'Age and sex not recorded'}</div>
        <div className="muted small">
          {own.length} case{own.length === 1 ? '' : 's'} · {procs} procedure{procs === 1 ? '' : 's'}
          {last.episode_start_date ? ` · last ${fmtDate(last.episode_start_date)}` : ''}
        </div>
      </div>
      <div className="patient-switch">
        <Segmented options={['Cases', 'Timeline']} value={view} onChange={(v) => setView(v as 'Cases' | 'Timeline')} label="Patient view" allowClear={false} />
      </div>
      {view === 'Timeline' ? (
        <PatientTimeline cases={own} />
      ) : (
        <>
          <h2 className="sechead">Procedures you can see</h2>
          <div className="group">
            {rows.map(({ c, p, date }) => {
              const done = c.collection_status === 'COMPLETED';
              const missing = done ? 0 : missingOf(c);
              return (
                <a key={`${c.case_id}.${p?.id ?? ''}`} href={`#/cases/${c.case_id}`} className="grow-row case-row" data-testid="patient-proc">
                  <span className="grow">
                    <span className="line1 card-top">
                      <b>{p ? procedureChip(p).text : 'MRN only'}</b>
                      <span className="card-date muted">{date ? fmtDate(date) : 'No date'}</span>
                    </span>
                    <span className="sub">
                      {groups.length > 1 && <span className="gdot" style={{ background: `var(--${groupColor(groups, c.group_id)})` } as CSSProperties} aria-hidden />}
                      {gname(c.group_id)} · <span className={`status ${done ? 's-done' : 's-prog'}`}>{done ? 'Completed' : 'In progress'}</span>
                      {missing > 0 && (
                        <>
                          {' · '}
                          <span className="missing">{missing} missing</span>
                        </>
                      )}
                    </span>
                  </span>
                  <Icon name="chevron" size={16} className="muted" />
                </a>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
