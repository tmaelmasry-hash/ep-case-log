// Hijri (Umm al-Qura) dates for the period filter (owner): dates are entered in Gregorian and the Hijri date is
// worked out automatically; Hijri shortcuts (year, Ramadan, Dhu al-Hijjah) become Gregorian From–To ranges.
import { todayISO } from './util';

const PARTS = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
const LONG = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

function hijriParts(date: string) {
  const p = PARTS.formatToParts(at(date));
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: n('year'), m: n('month'), d: n('day') };
}

/** "12 Jumada I 1448 AH" for a YYYY-MM-DD date. */
export function hijriLabel(date: string | null | undefined): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  return LONG.format(at(date));
}

/** Gregorian first and last day of Hijri month m (1–12) of year y, found by walking days near today. */
function monthRange(y: number, m: number): [string, string] | null {
  const today = todayISO();
  const t = hijriParts(today);
  // Rough start: about 354.4 days per Hijri year, 29.5 per month, from today.
  const offset = Math.round(((y - t.y) * 12 + (m - t.m)) * 29.53 - (t.d - 1));
  const d = at(today);
  d.setUTCDate(d.getUTCDate() + offset - 3);
  let first: string | null = null;
  for (let i = 0; i < 40; i++) {
    const h = hijriParts(iso(d));
    if (h.y === y && h.m === m) {
      first ??= iso(d);
    } else if (first) {
      d.setUTCDate(d.getUTCDate() - 1);
      return [first, iso(d)];
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return null;
}

/** Hijri shortcuts: this Hijri year so far, the latest Ramadan and the latest Dhu al-Hijjah (Hajj month). */
export function hijriPresets(): [string, string, string][] {
  const today = todayISO();
  const t = hijriParts(today);
  const out: [string, string, string][] = [];
  const start = monthRange(t.y, 1);
  if (start) out.push([`Hijri year ${t.y}`, start[0], today]);
  const ram = monthRange(t.m >= 9 ? t.y : t.y - 1, 9);
  if (ram) out.push([`Ramadan ${t.m >= 9 ? t.y : t.y - 1}`, ram[0], ram[1] > today ? today : ram[1]]);
  const hajjYear = t.m === 12 ? t.y : t.y - 1;
  const hajj = monthRange(hajjYear, 12);
  if (hajj) out.push([`Dhu al-Hijjah ${hajjYear}`, hajj[0], hajj[1] > today ? today : hajj[1]]);
  return out;
}
