// Field-value validation against the dictionary, ported from EP Workspace server/domain/validate.ts.
// Never invents a code: only dictionary codes pass.
import type { EntityDef, FormField } from './dictionary.ts';

export class FieldError extends Error {}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function validDate(y: number, m: number, d: number) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1900 && y <= 2100;
}

export function allowedCodes(f: FormField): string[] {
  return (f.codes ?? []).map((c) => c.code);
}

/** API value → stored value. Throws FieldError with a readable message. */
export function encodeValue(f: FormField, v: unknown, row: Record<string, unknown> = {}): unknown {
  if (v === null || v === undefined || v === '') return null;
  const label = f.label;
  switch (f.type) {
    case 'enum':
    case 'lookup':
    case 'boolean_unknown': {
      const s = String(v);
      if (!allowedCodes(f).includes(s)) throw new FieldError(`${label}: "${s}" is not one of the allowed values.`);
      if (f.parent_field && f.parent_map) {
        const parent = row[f.parent_field];
        if (parent && f.parent_map[s] !== parent) throw new FieldError(`${label}: this subtype does not belong to the selected diagnosis.`);
      }
      return s;
    }
    case 'lookup_array': {
      if (!Array.isArray(v)) throw new FieldError(`${label}: expected a list.`);
      const codes = allowedCodes(f);
      const uniq = [...new Set(v.map(String))];
      for (const c of uniq) if (!codes.includes(c)) throw new FieldError(`${label}: "${c}" is not one of the allowed values.`);
      // M-4b: codes that must stand alone (None, Unknown).
      const alone = uniq.filter((c) => f.exclusive?.includes(c));
      if (alone.length && uniq.length > 1) {
        const names = alone.map((c) => f.codes?.find((x) => x.code === c)?.label ?? c).join(' / ');
        throw new FieldError(`${label}: "${names}" cannot be combined with another choice.`);
      }
      if (!uniq.length) return null;
      return JSON.stringify(uniq.sort());
    }
    case 'boolean':
      if (v === true || v === 'true' || v === 1) return 1;
      if (v === false || v === 'false' || v === 0) return 0;
      throw new FieldError(`${label}: expected yes or no.`);
    case 'integer': {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      if (!Number.isInteger(n)) throw new FieldError(`${label}: enter a whole number.`);
      rangeCheck(f, n);
      return n;
    }
    case 'decimal': {
      const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
      if (!Number.isFinite(n)) throw new FieldError(`${label}: enter a number.`);
      rangeCheck(f, n);
      return n;
    }
    case 'date': {
      const m = DATE.exec(String(v));
      if (!m || !validDate(+m[1], +m[2], +m[3])) throw new FieldError(`${label}: enter a valid date.`);
      return String(v);
    }
    case 'datetime': {
      const s = String(v).slice(0, 16);
      const m = DATETIME.exec(s);
      if (!m || !validDate(+m[1], +m[2], +m[3]) || +m[4] > 23 || +m[5] > 59) throw new FieldError(`${label}: enter a valid date and time.`);
      return s;
    }
    case 'string': {
      const s = String(v).trim();
      if (CONTROL.test(s)) throw new FieldError(`${label}: contains control characters.`);
      if (f.maxLength && s.length > f.maxLength) throw new FieldError(`${label}: at most ${f.maxLength} characters.`);
      return s || null;
    }
    case 'fk':
      if (typeof v !== 'string' || !/^[a-z]+_[0-9a-f-]{36}$/.test(v)) throw new FieldError(`${label}: invalid link.`);
      return v;
    default:
      throw new FieldError(`${label}: cannot be edited here.`);
  }
}

function rangeCheck(f: FormField, n: number) {
  if (f.min !== undefined && n < f.min) throw new FieldError(`${f.label}: must be at least ${f.min}.`);
  if (f.max !== undefined && n > f.max) throw new FieldError(`${f.label}: must be at most ${f.max}.`);
  if (f.unit === '%' && (n < 0 || n > 100)) throw new FieldError(`${f.label}: must be between 0 and 100 %.`);
  if (n < 0 && f.type === 'integer' && /count|_bpm|_ms|_min|_days|_sec|beats/.test(f.name)) throw new FieldError(`${f.label}: cannot be negative.`);
}

/** Stored value → API value. */
export function decodeValue(f: FormField | undefined, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (!f) return v;
  if (f.type === 'boolean') return v === 1 || v === '1' || v === true;
  if (f.type === 'lookup_array' || f.type === 'json_object') {
    try {
      return JSON.parse(String(v));
    } catch {
      return null;
    }
  }
  return v;
}

export function holdsOther(f: FormField, stored: unknown): boolean {
  if (stored === null || stored === undefined) return false;
  if (f.type === 'lookup_array') {
    try {
      return (JSON.parse(String(stored)) as string[]).includes('OTHER');
    } catch {
      return false;
    }
  }
  return String(stored) === 'OTHER';
}

/** Spec §2.2: one other_specify_json per row; keys only for fields currently OTHER, ≤160 chars, sorted. */
export function mergeOtherSpecify(def: EntityDef, row: Record<string, unknown>, key: string | null, text: unknown): string | null {
  let obj: Record<string, string> = {};
  try {
    obj = row.other_specify_json ? JSON.parse(String(row.other_specify_json)) : {};
  } catch {
    obj = {};
  }
  if (key !== null) {
    const f = def.fields.find((x) => x.name === key);
    if (!f || !allowedCodes(f).includes('OTHER')) throw new FieldError('This field has no "Other" option.');
    const t = text === null || text === undefined ? '' : String(text).trim();
    if (CONTROL.test(t) || /[<>]/.test(t) || /^[=+\-@]/.test(t)) throw new FieldError('"Other — specify": plain text only (no markup or formula characters).');
    if (t.length > 160) throw new FieldError('"Other — specify": at most 160 characters.');
    if (t) obj[key] = t;
    else delete obj[key];
  }
  for (const k of Object.keys(obj)) {
    const f = def.fields.find((x) => x.name === k);
    if (!f || !holdsOther(f, row[k])) delete obj[k];
  }
  const keys = Object.keys(obj).sort();
  return keys.length ? JSON.stringify(Object.fromEntries(keys.map((k) => [k, obj[k]]))) : null;
}
