// Before a note leaves the server (phase 11; copied from EP Workspace server/ai/redact.ts): find the MRNs it names (a
// different MRN stops the extraction — O6), then remove what identifies a person: MRN, national ID / Iqama / passport,
// email, phone, and names (English and Arabic: after a label, after a title, relatives, a name opening a sentence and
// followed by an age or an identifier, and the case's saved full name). The date of birth stays, by the owner's decision
// (4 Nov 2026), so the AI can fill it; clinical numbers, procedure dates and clinical words stay too. This is best
// effort, not a guarantee: the person checks the text before it is sent (the "this is what will be sent" step).
// redact(redact(x)) = redact(x), because the server de-identifies the edited text again. Workers-safe; the note is
// never logged or stored.

const DIGITS: Record<string, string> = {};
'٠١٢٣٤٥٦٧٨٩'.split('').forEach((d, i) => { DIGITS[d] = String(i); });
'۰۱۲۳۴۵۶۷۸۹'.split('').forEach((d, i) => { DIGITS[d] = String(i); });
const ascii = (s: string) => s.replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d]);

const DC = '0-9٠-٩۰-۹';
const D = `[${DC}]`;
/** A word edge that also works for Arabic (\b knows only ASCII letters). */
const B = String.raw`(?<![\p{L}\p{N}_])`;
const E = String.raw`(?![\p{L}\p{N}_])`;
const SEP = String.raw`\s*[:#.\-=،]?\s*`;

const MRN_LABELLED = new RegExp(
  `${B}(?:MRN|M\\.R\\.N\\.?|medical record(?: number| no\\.?)?|hospital (?:number|no\\.?)|file (?:number|no\\.?)|رقم الملف(?: الطبي)?|الرقم الطبي|الملف الطبي|رقم طبي|رقم السجل الطبي|ملف رقم)${SEP}(${D}{5,}(?: ${D}{3,})*|${D}{2,4}(?: ${D}{2,4}){1,3})`,
  'giu',
);

const ID_LABELLED = new RegExp(
  `${B}(?:national id(?:entity)?(?: card)?|saudi id|civil id|id card|nid|id|iqamah?|igama|residence permit|passport|رقم الهوية(?: الوطنية)?|رقم الهويه|الهوية الوطنية|الهويه الوطنيه|الهوية|الهويه|هوية|رقم السجل المدني|السجل المدني|رقم الإقامة|رقم الاقامة|الإقامة|الاقامة|إقامة|اقامة|رقم الجواز|رقم جواز السفر|جواز السفر|جواز)(?:\\s*(?:number|num\\.?|no\\.?|رقم))?${SEP}([a-z]{0,2}${D}{6,14})${E}`,
  'giu',
);
/** Saudi national IDs start with 1 and Iqama numbers with 2, ten digits: removed even with no label. */
const ID_BARE = new RegExp(`${B}[12١٢۱۲]${D}{9}${E}`, 'gu');

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;

const PHONE_LABELLED = new RegExp(`${B}(?:telephone|phone|tel|mobile|mob|cell|contact|whatsapp|رقم التواصل|الجوال|جوال|الهاتف|هاتف|تلفون|موبايل)(?:\\s*(?:no\\.?|number|رقم))?${SEP}(\\+?${D}(?:[\\s-]?${D}){6,13})(?![${DC}/])`, 'giu');
const PHONE_INTL = new RegExp(`(?<![${DC}/])(?:\\+|00)${D}{1,3}(?:[\\s-]?${D}){7,11}(?![${DC}/])`, 'gu');
const PHONE = new RegExp(`(?<![${DC}/])(?:(?:\\+|00)${D}{1,3}[\\s-]?)?(?:0?5${D}|\\(?0${D}{1,2}\\)?)(?:[\\s-]?${D}){7}(?![${DC}/])`, 'gu');

// ── names ──

/** Words a name can never contain: clinical words and labels. They end a name, and an unlabelled "name" holding one is not a name. */
const NOT_NAME = new Set(
  `patient pt male female man woman boy girl elderly known stable alert conscious well tolerated improved unknown not none na n age aged sex gender mrn dob id iqama national passport date birth phone mobile
  had has have died dead deceased with without who was is are the and of on in at for from to no yes alive sudden living healthy
  hospital clinic department ward service team unit center centre
  hajj umrah pilgrim visitor typical atypical persistent paroxysmal permanent recurrent chronic acute primary secondary severe moderate mild redo first second elective urgent emergency inpatient outpatient
  atrial ventricular supraventricular sinus heart cardiac coronary artery fibrillation flutter tachycardia bradycardia block failure disease syndrome cardiomyopathy rhythm arrest syncope palpitations stroke diabetes mellitus hypertension
  af afl avnrt avrt wpw vt vf svt pvc pvcs pvi icd crt crtd ppm ep eps ecg ekg tee tte ct cmr mri echo holter lvef ef inr nyha lbbb rbbb cad hf htn dm ckd
  procedure ablation implant pacemaker device diagnosis indication history background plan medications medication discharge discharged admission admitted presented
  من في على إلى الى عن مع بعد قبل عند هو هي كان كانت تم قام قامت لديه لديها له لها يعاني تعاني عمره عمرها العمر سنة سنه عام الجنس ذكر أنثى انثى رقم الملف الطبي الهوية الهويه الإقامة الاقامة تاريخ الميلاد جوال هاتف المريض المريضة المريضه مريض مريضة مريضه
  مصاب مصابة توفي توفيت متوفى متوفية أجرى أجرت حضر حضرت دخل دخلت مستقر مستقرة مستقره المعالج المعالجة المسؤول غير يوجد لا نعم بخير حي حية
  رجفان أذيني اذيني أذينية اذينية رفرفة قصور القلب قلب تسرع بطء بطيني بطينية ضغط سكر السكري السكر الضغط الدم عضلة جلطة إغماء اغماء خفقان حج حاج حاجة عمرة معتمر قسطرة كي جهاز منظم عملية إجراء الإجراء`
    .split(/\s+/),
);
const CONNECTOR = /^(?:bin|ibn|bint|binte|al|el|abu|abd|abdul|ben)$/i;
const NAME_TITLE = /^(?:Mr|Mrs|Ms|Miss|Mister|Sheikh|Shaikh|Dr|Prof|السيد|السيدة|الشيخ|الأستاذ|الاستاذ|الأستاذة|الاستاذة|دكتور|الدكتور|دكتورة|الدكتورة)$/u;
const ARABIC_WORD = /^[\p{Script=Arabic}\p{Mn}]+$/u;

/** How many characters at the start of `s` are a person's name (0 = none). Arabic has no capitals, so a name there ends at punctuation, a NOT_NAME word, or `max` words. */
function nameLength(s: string, { anyCase = false, max = 4 }: { anyCase?: boolean; max?: number } = {}): number {
  const token = /[ \t]*([^\s,،;؛:()[\]/|<>"“”=]+)/uy;
  let pos = 0;
  let end = 0;
  let real = 0;
  for (;;) {
    token.lastIndex = pos;
    const m = token.exec(s);
    if (!m) break;
    const raw = m[1];
    const word = raw.replace(/\.+$/, '');
    if (real === 0 && NAME_TITLE.test(word)) {
      pos = token.lastIndex;
      continue;
    }
    if (!word || NOT_NAME.has(word.toLowerCase()) || /\p{N}/u.test(word)) break;
    if (CONNECTOR.test(word)) {
      if (!real) break;
      pos = token.lastIndex; // counts only if a name follows
      continue;
    }
    if (!ARABIC_WORD.test(word) && !(anyCase ? /^\p{L}/u : /^\p{Lu}/u).test(word)) break;
    real++;
    pos = token.lastIndex;
    end = pos - (raw.length - word.length); // a sentence's full stop stays
    if ((raw.endsWith('.') && word.length > 1) || real >= max) break;
  }
  return end;
}

/** Replaces the name after each match of `re`, keeping or dropping the label. */
function sweepNames(t: string, re: RegExp, opts: { anyCase?: boolean; max?: number }, out: (label: string) => string, hit: () => void): string {
  let res = '';
  let last = 0;
  for (const m of t.matchAll(re)) {
    if (m.index < last) continue; // inside a name just removed
    const start = m.index + m[0].length;
    const len = nameLength(t.slice(start, start + 200), opts);
    if (!len) continue;
    res += t.slice(last, m.index) + out(m[0]);
    last = start + len;
    hit();
  }
  return res + t.slice(last);
}

const NAME_LABEL = new RegExp(
  `${B}(?<!(?:drug|device|brand|generic|medication|procedure|product|model|lead|company|test|hospital|file|user)\\s)(?:full name|patient(?:'s|’s)? name|pt name|name|الاسم الكامل|اسم المريض|اسم المريضة|اسم المريضه|الاسم|الإسم|اسم)(?:\\s*[:=]\\s*|\\s+[-–]\\s+)`,
  'giu',
);
const PATIENT_LABEL = new RegExp(`${B}(?:patient|pt|المريض|المريضة|المريضه)(?:\\s*[:=]\\s*|\\s+[-–]\\s+)`, 'giu');
const CARER_LABEL = new RegExp(`${B}(?:consultant|operator|primary operator|physician|attending|surgeon|referring (?:doctor|physician)|referred by|next of kin|emergency contact|contact person|guardian|relative)(?:\\s*[:=]\\s*|\\s+[-–]\\s+)`, 'giu');
// Written case by case on purpose: "DR" is a pacemaker model suffix, and MR / MS are mitral regurgitation / stenosis.
const DOCTOR = new RegExp(`${B}(?:(?:Dr|dr|Prof|prof)(?:\\.\\s*|/\\s*|\\s+)|DR(?:\\.\\s*|/\\s*)|(?:Doctor|doctor|Professor|professor)\\s+|(?:د\\.|د/|أ\\.د\\.?|ا\\.د\\.?)\\s*|(?:دكتور|دكتوره|دكتورة|الدكتور|الدكتوره|الدكتورة|بروفيسور|البروفيسور)\\s+)`, 'gu');
const RELATIVE = new RegExp(`${B}(?:son|daughter|wife|husband|brother|sister|father|mother|nephew|niece|uncle|aunt)(?:\\s*[:=]\\s*|\\s+[-–]\\s+|\\s+(?:of\\s+)?)`, 'giu');
const RELATIVE_AR = new RegExp(`${B}(?:ابن|ابنه|ابنها|ابنة|ابنته|ابنتها|بنت|بنته|بنتها|زوج|زوجها|زوجة|زوجته|أخ|أخو|أخوه|أخوها|أخت|أخته|أختها|والد|والده|والدها|والدة|والدته|والدتها|ولي الأمر|قريب|قريبه|قريبها)(?:\\s+(?:المريض|المريضة))?(?:\\s*[:=]\\s*|\\s+[-–]\\s+|\\s+)`, 'gu');
const TITLE = new RegExp(`${B}(?:(?:Mr|Mrs|Ms|Miss|Mister|Sheikh|Shaikh|SHEIKH)(?:\\.\\s*|\\s+)|(?:السيد|السيدة|الشيخ|الأستاذ|الاستاذ|الأستاذة|الاستاذة)\\s+)`, 'gu');

// A name opening a sentence, known to be a name only by what follows it: an age or an identifier (or, for two words or more, a verb such as "presented").
const SENTENCE = String.raw`(?<=^|[.!?؟\n]\s*|\s[—–-]\s*|\[(?:MRN|ID|PHONE|EMAIL)\][,،]?\s*)`;
const STRICT_AGE = `${D}{1,3}\\s*-?\\s*(?:years?[\\s-]*old|yrs?[\\s-]*old|y[\\s-]*old|yo|y/o|y\\.o\\.?|M|F|male|female|man|woman)${E}`;
const LOOSE_AGE = `${D}{1,3}\\s*-?\\s*(?:y|yrs?|years?)${E}`;
const MARK = `(?:(?:\\s*[,،]\\s*|\\s+(?:is|was)\\s+(?:an?\\s+)?|\\s+(?:an?\\s+)?)?${STRICT_AGE}|\\s*[,،]\\s*${LOOSE_AGE}|\\s*[,،]?\\s*\\(?\\s*\\[?(?:MRN|DOB|D\\.O\\.B|ID|Iqama|National ID)${E}|\\s*[,،]?\\s+aged\\s+${D})`;
const VERB = String.raw`\s+(?:presented|was admitted|admitted|underwent|complains|complained|came|denies|reports|was referred|referred)${E}`;
const LATIN_NAME = String.raw`\p{Lu}[\p{L}'’-]+(?:\s+(?:(?:bin|ibn|al|el|abu)\s+)?\p{Lu}[\p{L}'’-]+){0,3}`;
const UNLABELLED = new RegExp(`(?:${SENTENCE}((?:Patient|Pt)\\s+)?|${B}((?:[Pp]atient|Pt)\\s+))(${LATIN_NAME})(?=${MARK}|(${VERB}))`, 'gmu');
const AR_WORD = String.raw`[\p{Script=Arabic}\p{Mn}]+`;
const AR_MARK = `\\s*[,،]?\\s*(?:عمره|عمرها|العمر|${D}{1,3}\\s*(?:سنة|سنه|عام)|رقم الملف|الرقم الطبي|رقم الهوية|رقم الهويه|رقم الإقامة|رقم الاقامة|تاريخ الميلاد|\\[MRN\\]|\\[ID\\])`;
const UNLABELLED_AR = new RegExp(`(?:${SENTENCE}((?:المريض|المريضة|المريضه)\\s+)?|${B}((?:المريض|المريضة|المريضه)\\s+))(${AR_WORD}(?:\\s+${AR_WORD}){1,3})(?=${AR_MARK})`, 'gmu');

function unlabelled(t: string, hit: () => void): string {
  const any = (name: string) => name.split(/\s+/).some((w) => NOT_NAME.has(w.toLowerCase()));
  t = t.replace(UNLABELLED, (all, pre1: string | undefined, pre2: string | undefined, name: string, verb: string | undefined, at: number, whole: string) => {
    const one = !/\s/.test(name);
    const after = whole.slice(at + all.length);
    if (any(name) || (one && (verb || !/^\s*[,،(]/.test(after)))) return all;
    hit();
    return `${pre1 ?? pre2 ?? ''}[NAME]`;
  });
  return t.replace(UNLABELLED_AR, (all, pre1: string | undefined, pre2: string | undefined, name: string) => {
    if (any(name)) return all;
    hit();
    return `${pre1 ?? pre2 ?? ''}[NAME]`;
  });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A regular expression for one part of the saved name; Arabic spelling variants (أ/ا, ة/ه, ى/ي), diacritics and a joined و/ب/ل/ف are tolerated. */
function namePartRe(part: string): RegExp {
  const clean = part.replace(/[ـ\p{Mn}]/gu, '');
  const arabic = ARABIC_WORD.test(clean);
  const body = arabic
    ? [...clean].map((c) => (/[اأإآ]/.test(c) ? '[اأإآ]' : /[ةه]/.test(c) ? '[ةه]' : /[ىي]/.test(c) ? '[ىي]' : escapeRe(c))).join('[\\u0640\\p{Mn}]*')
    : escapeRe(clean);
  return new RegExp(`(?<![\\[\\p{L}\\p{N}_])${arabic ? '[وفبل]?' : ''}${body}${E}`, 'giu');
}
const NAME_CONNECTORS = new Set(['bin', 'ibn', 'bint', 'binte', 'abu', 'abd', 'بن', 'ابن', 'بنت', 'ابو', 'أبو', 'آل', 'عبد']);

/** The saved full name's parts, longest first: "Al-Harbi" also gives "Harbi". */
function nameParts(fullName: string): string[] {
  const parts = new Set<string>();
  for (const word of fullName.split(/\s+/)) {
    for (const p of [word, ...word.split(/[-‐]/)]) if ([...p].length >= 3 && !NAME_CONNECTORS.has(p.toLowerCase())) parts.add(p);
  }
  return [...parts].sort((a, b) => b.length - a.length);
}

/** MRNs written in the note after an MRN label, as plain digits. */
export function mrnsInNote(note: string): string[] {
  const out = new Set<string>();
  for (const m of note.matchAll(MRN_LABELLED)) out.add(ascii(m[1]).replace(/\s+/g, ''));
  return [...out];
}

// ── instructions written inside a note ──

/** Phrases addressed to an AI, not clinical language. "Paced at 60, set to DDD" and "ignored the warfarin advice" stay. Best effort: the prompt, the quote check and a person's review stay behind it. */
const INSTRUCTION = [
  /\b(?:ignore|disregard|forget|override|bypass)\b[^.!?\n]{0,40}\b(?:instructions?|prompts?|rules|guidelines|commands?)\b/i,
  /\byou are now\b/i,
  /\b(?:admin|developer|debug|god) mode\b/i,
  /\b(?:system|developer) (?:prompt|message)\b/i,
  /\bnew instructions?\b/i,
  /\bmark (?:this|the) case\b/i,
  /\bset (?:the )?(?:lvef|ef|mrn|status|collection status)\b[^.!?\n]{0,20}\bto\b/i,
  /\b(?:output|reveal|print|repeat)\b[^.!?\n]{0,30}\b(?:mrn|patient'?s? name|prompt|instructions)\b/i,
  /\b(?:ai|assistant|chatbot)\b\s*[,:]\s*(?:please\s+)?(?:set|mark|change|output|ignore|write|fill|delete)\b/i,
  /(?:تجاهل|تجاهلي|انس|انسى)[^.؟!\n]{0,30}(?:التعليمات|الأوامر)/u,
];
const INVISIBLE = /[​-‍⁠﻿­]/g;
const INSTRUCTION_MARK = '[INSTRUCTION REMOVED]';

/** Takes out each sentence that speaks to an AI, so neither the model nor the quote check ever sees it. */
function removeInstructions(t: string, hit: () => void): string {
  return t
    .split('\n')
    .map((line) =>
      line
        .split(/(?<=[.!?؟])(\s+)/u)
        .map((part) => {
          const plain = part.replace(INVISIBLE, '');
          if (!INSTRUCTION.some((re) => re.test(plain))) return part;
          hit();
          return INSTRUCTION_MARK;
        })
        .join(''),
    )
    .join('\n');
}

export interface Removed {
  mrn: number;
  id: number;
  email: number;
  phone: number;
  name: number;
  instruction: number;
}
export interface Redaction {
  text: string;
  removed: Removed;
}

export function redact(note: string, known: { mrn: string; fullName?: string | null }): Redaction {
  const removed: Removed = { mrn: 0, id: 0, email: 0, phone: 0, name: 0, instruction: 0 };
  const hitName = () => { removed.name++; };
  let t = removeInstructions(note.replace(/\r\n?/g, '\n'), () => { removed.instruction++; });
  // Email first: a saved name must never leave "[NAME]@example.com" behind.
  t = t.replace(EMAIL, () => { removed.email++; return '[EMAIL]'; });
  t = t.replace(MRN_LABELLED, (all, num: string) => { removed.mrn++; return all.replace(num, '[MRN]'); });
  const mrn = known.mrn.replace(/\D/g, '');
  if (mrn.length >= 5) {
    t = t.replace(new RegExp(`${D}{5,}`, 'g'), (d) => (ascii(d) === mrn ? (removed.mrn++, '[MRN]') : d));
  }
  t = t.replace(ID_LABELLED, (all, num: string) => { removed.id++; return all.replace(num, '[ID]'); });
  t = t.replace(ID_BARE, () => { removed.id++; return '[ID]'; });
  t = t.replace(PHONE_LABELLED, (all, num: string) => { removed.phone++; return all.replace(num, '[PHONE]'); });
  t = t.replace(PHONE_INTL, () => { removed.phone++; return '[PHONE]'; });
  t = t.replace(PHONE, (p) => { if ((ascii(p).match(/\d/g) ?? []).length < 9) return p; removed.phone++; return '[PHONE]'; });

  t = sweepNames(t, NAME_LABEL, { anyCase: true, max: 5 }, (label) => `${label}[NAME]`, hitName);
  t = sweepNames(t, PATIENT_LABEL, { max: 5 }, (label) => `${label}[NAME]`, hitName);
  t = sweepNames(t, CARER_LABEL, { max: 5 }, (label) => `${label}[NAME]`, hitName);
  t = sweepNames(t, DOCTOR, {}, (label) => `${label}[NAME]`, hitName);
  t = sweepNames(t, RELATIVE, {}, (label) => `${label}[NAME]`, hitName);
  t = sweepNames(t, RELATIVE_AR, {}, (label) => `${label}[NAME]`, hitName);
  t = sweepNames(t, TITLE, {}, () => '[NAME]', hitName);
  t = unlabelled(t, hitName);
  for (const part of nameParts(String(known.fullName ?? ''))) t = t.replace(namePartRe(part), () => { removed.name++; return '[NAME]'; });
  // "[NAME] bin [NAME]" is one name, and counts as one.
  t = t.replace(/\[NAME\](?:\s+(?:(?:bin|ibn|بن|ابن|بنت|al|el)\s+)?\[NAME\])+/giu, (all) => {
    removed.name -= (all.match(/\[NAME\]/g) ?? []).length - 1;
    return '[NAME]';
  });
  return { text: t, removed };
}

/** Whitespace/quote-insensitive "is this quote really in the note" (plan §6 step 4: no manufactured quotes). */
export function normalizeForQuote(s: string): string {
  return s.replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** True when the quote is in the note (both normalised). A quote shortened with "..." or "…" counts when every piece is in the note, in order (seen live on Groq, 7 Nov). */
export function quoteInNote(note: string, quote: string): boolean {
  if (note.includes(quote)) return true;
  const pieces = quote.split(/\s*(?:\.{3,}|…)\s*/).map((s) => s.trim()).filter(Boolean);
  if (pieces.length < 2 && !/\.{3,}|…/.test(quote)) return false;
  if (!pieces.length || pieces.every((s) => s.length < 3)) return false;
  let from = 0;
  for (const s of pieces) {
    const at = note.indexOf(s, from);
    if (at < 0) return false;
    from = at + s.length;
  }
  return true;
}
