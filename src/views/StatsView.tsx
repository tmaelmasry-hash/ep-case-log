// Simple counts from the cases the user can see (the Admin dashboard and My work come in phase 9).
import { useMemo } from 'react';
import { label } from '../lib/dict';
import { fmtMonthKey, monthKey } from '../lib/util';
import { useStore } from '../store';
import { Empty } from '../components/ui';

function monthsBetween(a: string, b: string): string[] {
  const out: string[] = [];
  let [y, m] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  for (let guard = 0; (y < by || (y === by && m <= bm)) && guard < 600; guard++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

function MonthChart({ data }: { data: { month: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const W = 480;
  const H = 200;
  const padL = 30;
  const innerW = W - padL - 8;
  const innerH = H - 42;
  const bw = innerW / data.length;
  const every = Math.ceil(data.length / 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Episodes by month: ${data.map((d) => `${fmtMonthKey(d.month)} ${d.count}`).join(', ')}`}>
      {[0, max].map((t) => {
        const y = 18 + innerH - (t / max) * innerH;
        return (
          <g key={t}>
            <line x1={padL} x2={W - 8} y1={y} y2={y} className="grid" />
            <text x={padL - 6} y={y + 4} textAnchor="end" className="axis">
              {t}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const h = (d.count / max) * innerH;
        const w = Math.max(2, Math.min(40, bw * 0.64));
        const x = padL + i * bw + (bw - w) / 2;
        return (
          <g key={d.month}>
            <rect x={x} y={18 + innerH - h} width={w} height={h} rx={3} className="bar">
              <title>{`${fmtMonthKey(d.month)}: ${d.count}`}</title>
            </rect>
            {i % every === 0 && (
              <text x={x + w / 2} y={H - 6} textAnchor="middle" className="axis">
                {fmtMonthKey(d.month, false)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function StatsView() {
  const { cases } = useStore();
  const s = useMemo(() => {
    const procs = cases.flatMap((c) => c.procedures);
    const keys = cases.map((c) => c.episode_start_date).filter((x): x is string => !!x).map(monthKey).sort();
    const counts = new Map<string, number>();
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
    const byMonth = keys.length ? monthsBetween(keys[0], keys[keys.length - 1]).map((m) => ({ month: m, count: counts.get(m) ?? 0 })) : [];
    const tally = (xs: (string | null)[]) => {
      const m = new Map<string, number>();
      for (const x of xs) m.set(x ?? '', (m.get(x ?? '') ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    return {
      cases: cases.length,
      procedures: procs.length,
      patients: new Set(cases.map((c) => c.mrn)).size,
      byMonth,
      byType: tally(procs.map((p) => p.type)),
      byComponent: tally(procs.flatMap((p) => p.components)),
    };
  }, [cases]);

  return (
    <section className="view" aria-label="Stats">
      <h1 className="large-title">Stats</h1>
      <p className="muted small">Counts of the cases you can see. The Admin dashboard and My work come in phase 9.</p>
      {s.cases === 0 ? (
        <Empty icon="stats" title="No data yet">
          <p>Counts appear as cases are added.</p>
        </Empty>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <span className="kpi-num" data-testid="kpi-cases">{s.cases}</span>
              <span>Cases (episodes)</span>
            </div>
            <div className="kpi">
              <span className="kpi-num" data-testid="kpi-procedures">{s.procedures}</span>
              <span>Procedures</span>
            </div>
            <div className="kpi">
              <span className="kpi-num">{s.patients}</span>
              <span>Patients</span>
            </div>
          </div>
          {s.byMonth.length > 0 && (
            <div className="card pad">
              <h2 className="card-title">Episodes by month</h2>
              <MonthChart data={s.byMonth} />
            </div>
          )}
          <div className="card pad" data-testid="by-type">
            <h2 className="card-title">Procedures by type</h2>
            {s.byType.map(([code, n]) => (
              <div key={code} className="type-row">
                <span className="type-label">{code ? label('EP_PROCEDURES', 'primary_procedure_type', code) : 'Type not entered'}</span>
                <span className="type-bar">
                  <span style={{ width: `${(n / s.procedures) * 100}%` }} />
                </span>
                <span className="type-count">{n}</span>
              </div>
            ))}
          </div>
          {s.byComponent.length > 0 && (
            <div className="card pad">
              <h2 className="card-title">Procedure components</h2>
              {s.byComponent.map(([code, n]) => (
                <div key={code} className="type-row">
                  <span className="type-label">{label('PROCEDURE_COMPONENTS', 'component_type', code)}</span>
                  <span className="grow" />
                  <span className="type-count">{n}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
