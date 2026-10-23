// Field controls built from the dictionary type of each field (ported from EP Workspace public/js/components/fields.js,
// drawn in the approved EP Log style): short choices as a segmented control or pills, long lists as a dropdown.
import { useEffect, useRef, useState } from 'react';
import { codeLabel, editable, formFields, hasValue, offeredCodes, type EntityDef, type FormField } from '../../shared/dictionary.ts';
import { dict } from '../lib/dict';
import type { AiMark, DecodedRow } from '../../shared/caseTypes.ts';

const PILL_MAX = 8;

function shortLabels(f: FormField, codes: string[], max: number) {
  return codes.every((c) => codeLabel(f, c).length <= max);
}

type Kind = 'segmented' | 'pills' | 'select' | 'multi' | 'date' | 'datetime' | 'number' | 'text' | 'longtext' | 'fk' | 'none';

export function controlKind(f: FormField, row: DecodedRow | null): Kind {
  switch (f.type) {
    case 'enum':
    case 'lookup':
    case 'boolean_unknown': {
      const codes = offeredCodes(f, row);
      if (codes.length <= 3 && codes.reduce((n, c) => n + codeLabel(f, c).length, 0) <= 26) return 'segmented';
      if (codes.length <= PILL_MAX && shortLabels(f, codes, 26)) return 'pills';
      return 'select';
    }
    case 'boolean':
      return 'segmented';
    case 'lookup_array':
      return 'multi';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'integer':
    case 'decimal':
      return 'number';
    case 'string':
      // Free-text notes get a text box; names and short values a single line.
      return (f.maxLength ?? 0) > 120 || /(note|reference|description|comment|details|specify)/.test(f.name) ? 'longtext' : 'text';
    case 'fk':
      return 'fk';
    default:
      return 'none';
  }
}

/** Text and number inputs keep what is typed and save it only on leaving the field, on Enter (single line), or when the
 *  sheet closes with the field still open — never mid-typing, so a half-typed number is not saved or flagged (R2-2). */
function TypedInput({ id, value, onCommit, kind, f }: { id: string; value: unknown; onCommit: (v: string | null) => void; kind: 'number' | 'text' | 'longtext'; f: FormField }) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  const focused = useRef(false);
  const last = useRef(text);
  const pending = useRef(text);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  useEffect(() => {
    if (!focused.current) {
      const t = value === null || value === undefined ? '' : String(value);
      setText(t);
      last.current = t;
      pending.current = t;
    }
  }, [value]);
  const commit = (t: string) => {
    if (t === last.current) return;
    last.current = t;
    commitRef.current(t.trim() === '' ? null : t);
  };
  // Closing the sheet unmounts the input without a blur event: save what was typed.
  useEffect(() => () => commit(pending.current), []);
  const common = {
    id,
    value: text,
    onFocus: () => (focused.current = true),
    onBlur: () => {
      focused.current = false;
      commit(text);
    },
    onChange: (e: { target: { value: string } }) => {
      setText(e.target.value);
      pending.current = e.target.value;
    },
    autoComplete: 'off',
    'aria-label': f.label,
  };
  if (kind === 'longtext') return <textarea className="ios-text" rows={2} maxLength={f.maxLength} {...common} />;
  return (
    <span className="with-unit">
      <input
        className="ios-value"
        placeholder="Enter"
        inputMode={kind === 'number' ? (f.type === 'integer' ? 'numeric' : 'decimal') : 'text'}
        enterKeyHint="done"
        maxLength={f.maxLength}
        onKeyDown={(e) => e.key === 'Enter' && commit(text)}
        {...common}
      />
      {f.unit && <span className="muted small">{f.unit}</span>}
    </span>
  );
}

export interface FkOption {
  value: string;
  label: string;
}

/** A core field's state for "Not available": offered while empty; once recorded it shows its reason. */
export interface NaInfo {
  state: 'missing' | 'not_available';
  reason?: string;
}

function NaLine({ na, onNa, label }: { na: NaInfo; onNa: () => void; label: string }) {
  if (na.state === 'not_available')
    return (
      <span className="na-line">
        <span className="na-tag" data-testid="na-tag">
          Not available · {na.reason}
        </span>
        <button type="button" className="link small" onClick={onNa} data-testid="na-change" title={`Change "not available" for ${label}`}>
          Change
        </button>
      </span>
    );
  return (
    <span className="na-line">
      <button type="button" className="link small" onClick={onNa} data-testid="na-open" title={`${label}: not available`}>
        Not available…
      </button>
    </span>
  );
}

export function FieldRow({
  def,
  f,
  row,
  rowId,
  onChange,
  error,
  otherError,
  fkOptions,
  readOnly,
  na,
  onNa,
  copied,
  ai,
}: {
  def: EntityDef;
  f: FormField;
  row: DecodedRow | null;
  rowId: string;
  onChange: (field: string, value: unknown, key?: string) => void;
  error?: string;
  otherError?: string;
  fkOptions?: FkOption[];
  readOnly?: boolean;
  na?: NaInfo;
  onNa?: () => void;
  /** Where the value was copied from (same MRN), until someone edits it. */
  copied?: string;
  /** The AI filled this value (or proposes another); shown until a person accepts it or edits the field. */
  ai?: AiMark;
}) {
  const value = row?.[f.name] ?? null;
  const kind = controlKind(f, row);
  const id = `f-${def.entity}-${f.name}-${rowId}`.replace(/[^A-Za-z0-9_-]/g, '_');
  const star = dict.core.has(`${def.entity}.${f.name}`);
  const ro = readOnly || !editable(def, f);
  const lab = (
    <span className="lab">
      {f.label}
      {star && <span className="req" title="Core field"> *</span>}
      {copied && (
        <span className="copied-tag" title={copied} data-testid="copied-tag">
          Copied
        </span>
      )}
      {ai && (
        <span className={`ai-tag${ai.source === 'AI_CONFLICT' ? ' conflict' : ''}`} title={ai.evidence ? `From the note: “${ai.evidence}”` : 'Filled by the AI'} data-testid="ai-tag">
          {ai.source === 'AI_CONFLICT' ? 'AI conflict' : 'AI'}
        </span>
      )}
    </span>
  );
  const holdsOther = value === 'OTHER' || (Array.isArray(value) && value.includes('OTHER'));
  const other = holdsOther && !ro && def.fields.some((x) => x.name === 'other_specify_json') && (
    <div className="other-specify">
      <TypedInput id={`${id}-other`} kind="text" f={{ ...f, label: `${f.label}: Other — specify`, maxLength: 160 }} value={(row?.other_specify_json as Record<string, string> | null)?.[f.name] ?? ''} onCommit={(t) => onChange('other_specify_json', t ?? '', f.name)} />
      {otherError && <span className="field-error" role="alert">{otherError}</span>}
    </div>
  );
  const err = error && (
    <span className="field-error" role="alert">
      {error}
    </span>
  );
  const naLine = na && onNa && !ro && !hasValue(value) && <NaLine na={na} onNa={onNa} label={f.label} />;

  if (ro) {
    const shown = f.codes ? (Array.isArray(value) ? value.map((c) => codeLabel(f, c)).join(', ') : codeLabel(f, value)) : f.type === 'boolean' && value !== null ? (value ? 'Yes' : 'No') : value === null ? '' : String(value);
    return (
      <div className="frow inline" data-field={`${def.entity}.${f.name}`}>
        {lab}
        <span className="val">{shown || (na?.state === 'not_available' ? `Not available · ${na.reason}` : '—')}</span>
      </div>
    );
  }

  if (kind === 'segmented' || kind === 'pills' || kind === 'multi') {
    const codes = f.type === 'boolean' ? ['true', 'false'] : f.type === 'lookup_array' ? (f.codes ?? []).map((c) => c.code) : offeredCodes(f, row);
    const labelOf = (c: string) => (f.type === 'boolean' ? (c === 'true' ? 'Yes' : 'No') : codeLabel(f, c));
    const isOn = (c: string) => (f.type === 'boolean' ? value !== null && String(value) === c : Array.isArray(value) ? value.includes(c) : value === c);
    const pick = (c: string) => {
      if (kind === 'multi') {
        const cur = Array.isArray(value) ? (value as string[]) : [];
        onChange(f.name, cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]);
      } else if (f.type === 'boolean') onChange(f.name, isOn(c) ? null : c === 'true');
      else onChange(f.name, isOn(c) ? null : c);
    };
    if (f.parent_field && !codes.length) {
      return (
        <div className="frow stack" data-field={`${def.entity}.${f.name}`}>
          {lab}
          <span className="hint">Choose the {def.fields.find((x) => x.name === f.parent_field)?.label.toLowerCase() ?? 'parent field'} first.</span>
        </div>
      );
    }
    return (
      <div className="frow stack" data-field={`${def.entity}.${f.name}`}>
        {lab}
        <div className={kind === 'segmented' ? 'mini-seg' : 'pill-set'} role={kind === 'multi' ? 'group' : 'radiogroup'} aria-label={f.label} id={id}>
          {codes.map((c) => (
            <button key={c} type="button" role={kind === 'multi' ? undefined : 'radio'} aria-checked={kind === 'multi' ? undefined : isOn(c)} aria-pressed={kind === 'multi' ? isOn(c) : undefined} className={isOn(c) ? 'on' : ''} onClick={() => pick(c)}>
              {labelOf(c)}
            </button>
          ))}
        </div>
        {err}
        {other}
        {naLine}
      </div>
    );
  }

  let control;
  if (kind === 'select' || kind === 'fk') {
    const options: FkOption[] = kind === 'fk' ? (fkOptions ?? []) : offeredCodes(f, row).map((c) => ({ value: c, label: codeLabel(f, c) }));
    control = (
      <select id={id} className="ios-select" aria-label={f.label} value={value === null ? '' : String(value)} onChange={(e) => onChange(f.name, e.target.value || null)}>
        <option value="">{kind === 'fk' && !options.length ? 'Nothing to link yet' : 'Select'}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (kind === 'date' || kind === 'datetime') {
    control = <input id={id} className="ios-value" type={kind === 'date' ? 'date' : 'datetime-local'} aria-label={f.label} value={value === null ? '' : String(value)} onChange={(e) => onChange(f.name, e.target.value || null)} />;
  } else if (kind === 'number' || kind === 'text') {
    control = <TypedInput id={id} kind={kind} f={f} value={value} onCommit={(t) => onChange(f.name, t)} />;
  } else if (kind === 'longtext') {
    return (
      <div className="frow stack" data-field={`${def.entity}.${f.name}`}>
        {lab}
        <TypedInput id={id} kind="longtext" f={f} value={value} onCommit={(t) => onChange(f.name, t)} />
        {err}
        {naLine}
      </div>
    );
  } else {
    return null;
  }
  return (
    <div className="frow inline" data-field={`${def.entity}.${f.name}`}>
      <label htmlFor={id} className="lab-wrap">
        {lab}
      </label>
      {control}
      {err && <div className="frow-err">{err}</div>}
      {other && <div className="frow-err">{other}</div>}
      {naLine && <div className="frow-err">{naLine}</div>}
    </div>
  );
}

/** All form fields of one row of an entity, in dictionary order (core fields marked ★). */
export function EntityFields({
  entity,
  row,
  rowId,
  onChange,
  errorOf,
  fkOptions,
  readOnly,
  naOf,
  onNa,
  copiedOf,
  aiOf,
  only,
}: {
  entity: string;
  row: DecodedRow | null;
  rowId: string;
  onChange: (field: string, value: unknown, key?: string) => void;
  errorOf: (field: string) => string | undefined;
  fkOptions: (f: FormField) => FkOption[];
  readOnly?: boolean;
  naOf?: (field: string) => NaInfo | undefined;
  onNa?: (field: string) => void;
  copiedOf?: (field: string) => string | undefined;
  aiOf?: (field: string) => AiMark | undefined;
  /** Show only these fields (in this order). */
  only?: string[];
}) {
  const def = dict.entities[entity];
  const list = only ? only.map((n) => formFields(def).find((f) => f.name === n)).filter((f): f is FormField => !!f) : formFields(def);
  return (
    <div className="group">
      {list.map((f) => (
        <FieldRow
          key={f.name}
          def={def}
          f={f}
          row={row}
          rowId={rowId}
          onChange={onChange}
          error={errorOf(f.name)}
          otherError={errorOf(`other_specify_json:${f.name}`)}
          fkOptions={f.type === 'fk' ? fkOptions(f) : undefined}
          readOnly={readOnly}
          na={naOf?.(f.name)}
          onNa={onNa ? () => onNa(f.name) : undefined}
          copied={copiedOf?.(f.name)}
          ai={aiOf?.(f.name)}
        />
      ))}
    </div>
  );
}
