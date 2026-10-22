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

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '';
  const d = parseISO(s.slice(0, 10));
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function fmtShortDate(s: string | null | undefined): string {
  if (!s) return '';
  const d = parseISO(s.slice(0, 10));
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
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

/** "58M", "71F" — sex codes from the dictionary (MALE / FEMALE). */
export function ageSex(age: number | null, sex: string | null): string {
  const s = sex === 'MALE' ? 'M' : sex === 'FEMALE' ? 'F' : '';
  return `${age ?? ''}${s}`;
}
