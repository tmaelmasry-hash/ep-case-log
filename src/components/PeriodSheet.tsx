// Period filter (owner R2-8): episode start date From–To in Gregorian; the Hijri date is shown under each one.
import { useState } from 'react';
import { setFilters, useFilters } from '../lib/filters';
import { hijriLabel } from '../lib/hijri';
import { Sheet } from './ui';

export function PeriodSheet({ onClose }: { onClose: () => void }) {
  const f = useFilters();
  const [from, setFrom] = useState(f.from ?? '');
  const [to, setTo] = useState(f.to ?? '');
  const apply = (a: string, b: string) => {
    setFilters({ from: a || null, to: b || null });
    onClose();
  };
  return (
    <Sheet title="Period" onClose={onClose} onDone={() => apply(from, to)} testId="period-sheet">
      <div className="group">
        <div className="frow inline">
          <label className="lab-wrap" htmlFor="period-from">
            <span className="lab">From</span>
            {from && <span className="muted small hijri">{hijriLabel(from)}</span>}
          </label>
          <input id="period-from" className="ios-value" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="frow inline">
          <label className="lab-wrap" htmlFor="period-to">
            <span className="lab">To</span>
            {to && <span className="muted small hijri">{hijriLabel(to)}</span>}
          </label>
          <input id="period-to" className="ios-value" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <p className="muted small">By the episode start date. Combines with the procedures and cohorts you picked.</p>
      <button className="btn block" onClick={() => apply('', '')}>
        Any date
      </button>
    </Sheet>
  );
}
