import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { CATEGORY_COLOR } from '../lib/catalog';
import { computeStats, rangeFor, type DateRange, type RangeKey } from '../lib/stats';
import { fmtMonthKey, todayISO } from '../lib/util';
import { Empty, Segmented } from '../components/ui';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: '12mo', label: '12mo' },
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom' },
];

function MonthChart({ data }: { data: { month: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 2), max];
  const W = 480;
  const H = 220;
  const padL = 30;
  const padB = 24;
  const innerW = W - padL - 8;
  const innerH = H - padB - 18;
  const bw = innerW / data.length;
  const labelEvery = Math.ceil(data.length / 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Cases by month: ${data.map((d) => `${fmtMonthKey(d.month)} ${d.count}`).join(', ')}`}>
      {ticks.map((t) => {
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
        const w = Math.max(2, Math.min(44, bw * 0.64));
        const x = padL + i * bw + (bw - w) / 2;
        const [y, m] = d.month.split('-');
        return (
          <g key={d.month}>
            <rect x={x} y={18 + innerH - h} width={w} height={h} rx={Math.min(4, w / 3)} className="bar">
              <title>{`${fmtMonthKey(d.month)}: ${d.count} case${d.count === 1 ? '' : 's'}`}</title>
            </rect>
            {d.count > 0 && data.length <= 18 && (
              <text x={x + w / 2} y={18 + innerH - h - 4} textAnchor="middle" className="bar-val">
                {d.count}
              </text>
            )}
            {i % labelEvery === 0 && (
              <text x={x + w / 2} y={H - 6} textAnchor="middle" className="axis">
                {fmtMonthKey(d.month, false)}
                {m === '01' || i === 0 ? ` ${y.slice(2)}` : ''}
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
  const [range, setRange] = useState<RangeKey>('all');
  const [custom, setCustom] = useState<DateRange>({ from: null, to: todayISO() });
  const customError = range === 'custom' && custom.from && custom.to && custom.from > custom.to ? 'Start date must be before end date' : null;
  const r = rangeFor(range, custom);
  const stats = useMemo(() => computeStats(cases, customError ? { from: null, to: null } : r), [cases, r.from, r.to, customError]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="view" aria-label="Stats">
      <h1 className="large-title">Stats</h1>
      <Segmented label="Date range" allowClear={false} options={RANGES.map((x) => x.label)} value={RANGES.find((x) => x.key === range)!.label} onChange={(v) => setRange(RANGES.find((x) => x.label === v)!.key)} />
      {range === 'custom' && (
        <div className="field-row custom-range">
          <label className="field">
            <span>From</span>
            <input type="date" value={custom.from ?? ''} onChange={(e) => setCustom({ ...custom, from: e.target.value || null })} />
          </label>
          <label className="field">
            <span>To</span>
            <input type="date" value={custom.to ?? ''} onChange={(e) => setCustom({ ...custom, to: e.target.value || null })} />
          </label>
        </div>
      )}
      {customError && (
        <p className="field-error" role="alert">
          {customError}
        </p>
      )}

      {cases.length === 0 ? (
        <Empty icon="stats" title="No data yet">
          <p>Statistics update automatically as you log cases.</p>
        </Empty>
      ) : (
        <>
          <div className="kpis" data-testid="kpis">
            <div className="kpi">
              <span className="kpi-num" data-testid="kpi-cases">
                {stats.caseCount}
              </span>
              <span>Cases</span>
            </div>
            <div className="kpi">
              <span className="kpi-num" data-testid="kpi-procedures">
                {stats.procedureCount}
              </span>
              <span>Procedures</span>
            </div>
            <div className="kpi">
              <span className="kpi-num">{stats.patientCount}</span>
              <span>Patients</span>
            </div>
            <div className="kpi">
              <span className="kpi-num" data-testid="kpi-comp">
                {stats.caseCount ? `${(stats.complicationRate * 100).toFixed(1)}%` : '—'}
              </span>
              <span>Complication rate</span>
            </div>
          </div>

          {stats.caseCount === 0 ? (
            <Empty icon="stats" title="No cases in this range" />
          ) : (
            <>
              <div className="card pad">
                <h2 className="card-title">Cases by Month</h2>
                <MonthChart data={stats.byMonth} />
              </div>
              <div className="card pad" data-testid="by-type">
                <h2 className="card-title">Procedures by Type</h2>
                {stats.byCategory.map((cat) => (
                  <div key={cat.category} className="cat-block">
                    <div className="cat-head">
                      <span className="dot" style={{ background: CATEGORY_COLOR[cat.category] }} />
                      <b>{cat.category}</b>
                      <span className="grow" />
                      <b>{cat.count}</b>
                    </div>
                    {cat.types.map((t) => (
                      <div key={t.label} className="type-row">
                        <span className="type-label">{t.label}</span>
                        <span className="type-bar">
                          <span style={{ width: `${t.pct * 100}%`, background: CATEGORY_COLOR[cat.category] }} />
                        </span>
                        <span className="type-count">{t.count}</span>
                        <span className="muted type-pct">{Math.round(t.pct * 100)}%</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="card pad">
                <h2 className="card-title">Complications</h2>
                {stats.complications.length === 0 ? (
                  <p className="muted">None recorded in this range.</p>
                ) : (
                  <>
                    <p className="muted small">
                      {stats.complicationCases} of {stats.caseCount} cases had at least one complication.
                    </p>
                    {stats.complications.map((c) => (
                      <div key={c.label} className="type-row">
                        <span className="type-label">{c.label}</span>
                        <span className="grow" />
                        <span className="type-count">{c.count}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
