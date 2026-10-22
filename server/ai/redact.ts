// Before a note leaves the server (phase 11; copied from EP Workspace server/ai/redact.ts): find the MRNs it names (a different MRN stops the
// extraction — O6), then remove MRNs, phone numbers and names. Best effort for names: those after a title or
// a "Patient:/Name:" label, and the case's saved full name. Workers-safe; the note is never logged or stored.

const DIGITS: Record<string, string> = {};
'٠١٢٣٤٥٦٧٨٩'.split('').forEach((d, i) => { DIGITS[d] = String(i); });
'۰۱۲۳۴۵۶۷۸۹'.split('').forEach((d, i) => { DIGITS[d] = String(i); });
const ascii = (s: string) => s.replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d]);

const MRN_LABELLED = /\b(?:MRN|M\.R\.N\.?|medical record(?: number| no\.?)?|hospital (?:number|no\.?)|file (?:number|no\.?))\s*[:#.\-]?\s*([0-9٠-٩۰-۹][0-9٠-٩۰-۹ ]{3,14}[0-9٠-٩۰-۹])/gi;
const PHONE = /(?<![\d/])(?:(?:\+|00)\d{1,3}[\s-]?)?(?:0?5\d|\(?0\d{1,2}\)?)(?:[\s-]?\d){7}(?![\d/])/g;
const TITLE_NAME = /\b(?:Mr|Mrs|Ms|Miss|Mister|Sheikh|Shaikh)\.?\s+[A-Z][A-Za-z'’-]+(?:\s+(?:al-|Al-|bin |ibn )?[A-Z][A-Za-z'’-]+){0,3}/g;
const LABEL_NAME = /\b(Patient(?:'s)? name|Patient|Name|Pt)\s*[:\-]\s*(?:Mr\.?|Mrs\.?|Ms\.?)?\s*[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,3}/g;

/** MRNs written in the note after an MRN label, as plain digits. */
export function mrnsInNote(note: string): string[] {
  const out = new Set<string>();
  for (const m of note.matchAll(MRN_LABELLED)) out.add(ascii(m[1]).replace(/\s+/g, ''));
  return [...out];
}

export interface Redaction { text: string; removed: { mrn: number; phone: number; name: number } }

export function redact(note: string, known: { mrn: string; fullName?: string | null }): Redaction {
  const removed = { mrn: 0, phone: 0, name: 0 };
  let t = note.replace(/\r\n?/g, '\n');
  t = t.replace(MRN_LABELLED, (all, num) => { removed.mrn++; return all.replace(num, '[MRN]'); });
  const mrn = known.mrn.replace(/\D/g, '');
  if (mrn.length >= 5) {
    t = t.replace(/[0-9٠-٩۰-۹]{5,}/g, (d) => (ascii(d) === mrn ? (removed.mrn++, '[MRN]') : d));
  }
  t = t.replace(PHONE, (p) => { if ((p.match(/\d/g) ?? []).length < 9) return p; removed.phone++; return '[PHONE]'; });
  t = t.replace(LABEL_NAME, (all, label) => { removed.name++; return `${label}: [NAME]`; });
  t = t.replace(TITLE_NAME, () => { removed.name++; return '[NAME]'; });
  for (const part of String(known.fullName ?? '').split(/\s+/).filter((p) => p.length >= 3)) {
    const re = new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    t = t.replace(re, () => { removed.name++; return '[NAME]'; });
  }
  t = t.replace(/\[NAME\](?:\s+\[NAME\])+/g, '[NAME]');
  return { text: t, removed };
}

/** Whitespace/quote-insensitive "is this quote really in the note" (plan §6 step 4: no manufactured quotes). */
export function normalizeForQuote(s: string): string {
  return s.replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
}
