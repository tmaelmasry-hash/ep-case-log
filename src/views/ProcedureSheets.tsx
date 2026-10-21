import { useState } from 'react';
import { CATEGORIES, PROCEDURES, PROC_BY_TYPE, missingRequired, numberError, type FieldDef } from '../lib/catalog';
import type { FieldValue, Procedure } from '../lib/types';
import { uid } from '../lib/util';
import { Icon } from '../components/Icon';
import { ChipSelect, Segmented, Sheet } from '../components/ui';

export function ProcedurePicker({ onPick, onClose }: { onPick: (type: string) => void; onClose: () => void }) {
  return (
    <Sheet title="Add Procedure" onClose={onClose} testId="procedure-picker">
      {CATEGORIES.map((cat) => {
        const items = PROCEDURES.filter((p) => p.category === cat);
        return (
          <div key={cat} className="picker-group">
            <h3 className="section-label">{cat}</h3>
            <div className="picker-grid">
              {items.map((p) => (
                <button key={p.type} className="picker-tile" onClick={() => onPick(p.type)}>
                  <Icon name={p.icon} size={26} />
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </Sheet>
  );
}

function FieldInput({ f, value, onChange }: { f: FieldDef; value: FieldValue; onChange: (v: FieldValue) => void }) {
  switch (f.kind) {
    case 'segmented':
      return <Segmented label={f.label} options={f.options!} value={(value as string) ?? ''} onChange={onChange} />;
    case 'multi':
      return <ChipSelect label={f.label} options={f.options!} value={(value as string[]) ?? []} onChange={onChange} />;
    case 'select':
      return (
        <select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={f.label}>
          <option value="">Select…</option>
          {f.options!.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    case 'number':
      return (
        <div className="with-unit">
          <input
            inputMode="decimal"
            aria-label={f.label}
            value={value === null || value === undefined ? '' : String(value)}
            onChange={(e) => {
              const s = e.target.value.replace(/[^\d.]/g, '');
              onChange(s === '' ? null : Number(s));
            }}
          />
          {f.unit && <span className="muted">{f.unit}</span>}
        </div>
      );
    case 'toggle':
      return (
        <label className="switch">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} aria-label={f.label} />
          <span className="switch-ui" />
        </label>
      );
    default:
      return <input aria-label={f.label} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Create or edit one procedure's structured details. */
export function ProcedureSheet({
  type,
  existing,
  onSave,
  onDelete,
  onClose,
}: {
  type: string;
  existing?: Procedure;
  onSave: (p: Procedure) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const def = PROC_BY_TYPE[type];
  const [details, setDetails] = useState<Record<string, FieldValue>>(existing?.details ?? {});
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [tried, setTried] = useState(false);
  if (!def) return null;
  const missing = missingRequired(type, details);
  const numErrors = def.fields.map((f) => (f.kind === 'number' ? numberError(f, details[f.key]) : null));
  const valid = missing.length === 0 && numErrors.every((e) => !e);

  const save = () => {
    setTried(true);
    if (!valid) return;
    onSave({ id: existing?.id ?? uid(), type, details, notes: notes.trim() });
  };

  return (
    <Sheet title={def.label} onClose={onClose} onDone={save} testId="procedure-sheet">
      <div className="card form-card">
        {def.fields.map((f, i) => (
          <div key={f.key} className={`field${f.kind === 'toggle' ? ' inline' : ''}`}>
            <span>
              {f.label}
              {f.required && <i className="req"> *</i>}
            </span>
            <FieldInput f={f} value={details[f.key] ?? null} onChange={(v) => setDetails((d) => ({ ...d, [f.key]: v }))} />
            {tried && missing.includes(f.label) && (
              <span className="field-error" role="alert">
                Required
              </span>
            )}
            {numErrors[i] && (
              <span className="field-error" role="alert">
                {numErrors[i]}
              </span>
            )}
          </div>
        ))}
      </div>
      <h3 className="section-label">Notes</h3>
      <textarea className="card notes-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Procedure-specific notes" aria-label="Procedure notes" />
      {tried && !valid && (
        <p className="field-error" role="alert">
          {missing.length ? `Please complete: ${missing.join(', ')}` : 'Please fix the highlighted fields'}
        </p>
      )}
      <button className="btn primary block" onClick={save}>
        {existing ? 'Save procedure' : 'Add procedure'}
      </button>
      {onDelete && (
        <button className="btn danger-text block" onClick={onDelete}>
          <Icon name="trash" size={18} /> Remove procedure
        </button>
      )}
    </Sheet>
  );
}
