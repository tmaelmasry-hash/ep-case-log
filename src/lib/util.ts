export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as a local date. */
export function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function fmtDate(s: string): string {
  if (!s) return '';
  const d = parseISO(s);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

export function monthKey(s: string): string {
  return s.slice(0, 7);
}

export function fmtMonthKey(k: string, long = true): string {
  const [y, m] = k.split('-').map(Number);
  return long ? `${MONTHS_LONG[m - 1]} ${y}` : `${MONTHS[m - 1]}`;
}

export function patientLine(mrn: string, age: number | null, sex: string): string {
  const as = `${age ?? ''}${sex}`;
  return [mrn, as].filter(Boolean).join(' · ');
}

export interface CaseFieldErrors {
  date?: string;
  mrn?: string;
  age?: string;
  fluoroMin?: string;
}

export function validateCaseFields(v: { date: string; mrn: string; age: string; fluoroMin?: string }, now = new Date()): CaseFieldErrors {
  const e: CaseFieldErrors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) e.date = 'Enter a valid date';
  else {
    const d = parseISO(v.date);
    if (Number.isNaN(d.getTime())) e.date = 'Enter a valid date';
    else if (d.getFullYear() < 1990) e.date = 'Date is too far in the past';
    else if (v.date > todayISO(now)) e.date = 'Date cannot be in the future';
  }
  const mrn = v.mrn.trim();
  if (!mrn) e.mrn = 'MRN is required';
  else if (!/^[A-Za-z0-9-]{1,20}$/.test(mrn)) e.mrn = 'Letters, digits or dashes (max 20)';
  if (v.age.trim() !== '') {
    const n = Number(v.age);
    if (!Number.isInteger(n) || n < 0 || n > 120) e.age = 'Age must be 0–120';
  }
  if (v.fluoroMin && v.fluoroMin.trim() !== '') {
    const n = Number(v.fluoroMin);
    if (Number.isNaN(n) || n < 0 || n > 600) e.fluoroMin = 'Fluoro time must be 0–600 min';
  }
  return e;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
