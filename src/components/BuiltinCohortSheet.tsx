// Edit a built-in cohort (owner, 23 Oct): the Admin renames, recolors or hides it; it is never deleted and
// "Reset to default" brings back the original name and color.
import { useState } from 'react';
import { COHORT_COLORS } from '../../shared/cohorts.ts';
import { api, ApiError } from '../lib/api';
import { overrideOf, refreshCohorts } from '../lib/cohorts';
import { itemColor, matcher } from '../lib/filters';
import { useStore } from '../store';
import { Sheet } from './ui';

export function BuiltinCohortSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { toast } = useStore();
  const item = matcher.item(id)!;
  const o = overrideOf(id) ?? {};
  const [label, setLabel] = useState(o.label ?? item.label);
  const [color, setColor] = useState(o.color ?? itemColor(id));
  const [hidden, setHidden] = useState(!!o.hidden);
  const [busy, setBusy] = useState(false);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api('POST', `/api/cohorts/builtin/${id}`, body);
      await refreshCohorts();
      onClose();
    } catch (e) {
      toast({ message: (e as ApiError).message, kind: 'error' });
      setBusy(false);
    }
  };
  const save = () => send({ label: label.trim() === item.label ? '' : label, color, hidden });

  return (
    <Sheet title="Edit cohort" onClose={onClose} onDone={save} doneLabel="Save" doneDisabled={busy} testId="builtin-cohort-sheet">
      <div className="group">
        <div className="frow inline">
          <label className="lab-wrap" htmlFor="builtin-name">
            <span className="lab">Name</span>
          </label>
          <input id="builtin-name" className="ios-value" maxLength={60} placeholder={item.label} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <label className="frow inline">
          <span className="lab">Hide from the menu</span>
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} aria-label="Hide from the menu" />
        </label>
      </div>
      <div className="cohort-colors" role="radiogroup" aria-label="Color">
        {[...new Set([itemColor(id), ...COHORT_COLORS])].map((c) => (
          <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} className={`swatch${color === c ? ' on' : ''}`} style={{ background: `var(--${c})` }} onClick={() => setColor(c)} />
        ))}
      </div>
      <p className="muted small">Built-in cohorts are never deleted. A hidden one stays under "Hidden cohorts" for the Admin, ready to show again.</p>
      <button className="btn primary block" onClick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button className="btn block" onClick={() => send({ reset: true })} disabled={busy}>
        Reset to default
      </button>
    </Sheet>
  );
}
