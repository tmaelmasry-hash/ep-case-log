// De-identification before a note leaves the server. Made-up people and numbers only.
import { describe, expect, it } from 'vitest';
import rawFixtures from '../../config/ai_fixtures.json';
import { mrnsInNote, normalizeForQuote, redact } from '../../server/ai/redact.ts';

const fixtures = rawFixtures.notes;
const known = { mrn: '9990701' };
const out = (note: string, fullName?: string) => redact(note, { ...known, fullName }).text;

describe('redact removes identifiers', () => {
  it.each([
    ['English name after Name:', 'Name: Ahmed Zahrani. Stable.', 'Ahmed'],
    ['all-capitals name', 'PATIENT NAME: AHMED ZAHRANI', 'AHMED'],
    ['lower-case name after Name:', 'name: ahmed zahrani, 65 y', 'ahmed'],
    ['Patient: with a title', 'Patient: Mr. Salem Testperson, mobile', 'Salem'],
    ['Patient and a name with no colon', 'Patient Sara Placeholder, DOB 15/11/1990, female', 'Sara'],
    ['Arabic name after Name:', 'Name: أحمد الزهراني', 'أحمد'],
    ['Arabic name after الاسم:', 'الاسم: فاطمة الحربي', 'فاطمة'],
    ['Arabic name after اسم المريض:', 'اسم المريض: خالد عبد الله العتيبي', 'العتيبي'],
    ['Arabic name after المريض:', 'المريض: سارة القحطاني', 'سارة'],
    ['Dr. and a name', 'Seen by Dr. Ahmed Zahrani today.', 'Zahrani'],
    ['Dr with no dot', 'Consent taken by Dr Noura Testperson.', 'Noura'],
    ['Operator label', 'Operator: Salem Testperson', 'Salem'],
    ['Arabic doctor', 'تم الإجراء بواسطة د. أحمد الزهراني', 'الزهراني'],
    ['Arabic doctor, full word', 'الدكتورة نورة الغامدي قامت بالإجراء', 'نورة'],
    ['son', 'Son Khalid Alharbi was informed.', 'Khalid'],
    ['daughter', 'Consent from his daughter Reem Testperson', 'Reem'],
    ['next of kin', 'Next of kin: Omar Testperson', 'Omar'],
    ['Arabic son', 'ابنه خالد الحربي حضر', 'خالد'],
    ['Arabic daughter', 'بنت المريض فاطمة الحربي', 'فاطمة'],
    ['name opening a note, then age', 'Ahmed Alharbi, 65-year-old man with AF.', 'Alharbi'],
    ['name opening a sentence, is a', 'Referred today. Ahmed Alharbi is a 65-year-old man.', 'Ahmed'],
    ['name opening a sentence, then a verb', 'Ahmed Alharbi presented with palpitations.', 'Ahmed'],
    ['single name, comma, age', 'Ahmed, 65 y, male', 'Ahmed'],
    ['name after a dash', '[MRN] — Omar Sample, 58 y, male.', 'Omar'],
    ['name before (MRN', 'Fatimah Madeup (MRN 9990701), 81-year-old woman', 'Fatimah'],
    ['name before DOB', 'Noura Invented, DOB 21/07/1970, female', 'Noura'],
    ['Arabic name opening a sentence, then age', 'أحمد الزهراني، 65 سنة، رجفان أذيني', 'الزهراني'],
    ['Arabic patient, name, age', 'المريض أحمد الزهراني عمره 65', 'أحمد'],
    ['national ID in Arabic', 'رقم الهوية 1012345678', '1012345678'],
    ['national ID with Arabic digits', 'رقم الهوية ١٠١٢٣٤٥٦٧٨', '١٠١٢٣٤٥٦٧٨'],
    ['National ID', 'National ID 1012345678', '1012345678'],
    ['Iqama', 'Iqama 2412345678', '2412345678'],
    ['Iqama No.', 'Iqama No. 2412345678', '2412345678'],
    ['Arabic Iqama', 'رقم الإقامة: 2412345678', '2412345678'],
    ['passport', 'Passport A1234567', 'A1234567'],
    ['ten digits with no label', 'Contact on file 1012345678 only', '1012345678'],
    ['email', 'Mail salem.t+ep@example.com please', 'example.com'],
    ['Saudi mobile', 'Call 0551234567', '0551234567'],
    ['Saudi mobile, Arabic digits', 'جوال ٠٥٥١٢٣٤٥٦٧', '٠٥٥١٢٣٤٥٦٧'],
    ['international number', 'contact +966 50 765 4321', '765'],
    ['international landline', 'Tel +966-12-1234567', '1234567'],
    ['labelled MRN', 'MRN 9990701', '9990701'],
    ['Arabic labelled MRN', 'رقم الملف: 9990701', '9990701'],
    ['this case’s MRN with no label', 'seen 9990701 today', '9990701'],
    ['this case’s MRN in Arabic digits', 'seen ٩٩٩٠٧٠١ today', '٩٩٩٠٧٠١'],
  ])('%s', (_label, note, gone) => {
    expect(out(note)).not.toContain(gone);
  });

  it('uses placeholders and counts what it removed', () => {
    const r = redact('Name: Ahmed Zahrani. MRN 9990701. National ID 1012345678. Mail a.z@example.com. Mobile 0551234567. Seen by Dr. Salem Testperson. Son Khalid Alharbi informed.', known);
    expect(r.text).toBe('Name: [NAME]. MRN [MRN]. National ID [ID]. Mail [EMAIL]. Mobile [PHONE]. Seen by Dr. [NAME]. Son [NAME] informed.');
    expect(r.removed).toEqual({ mrn: 1, id: 1, email: 1, phone: 1, name: 3, instruction: 0 });
  });

  it('removes a measured made-up note of every kind', () => {
    const note = [
      'الاسم: أحمد الزهراني',
      'رقم الهوية 1012345678',
      'Ahmed Zahrani presented with palpitations. National ID 1012345678. Iqama 2412345678.',
      'Mail him at ahmed.z@example.com. Seen by Dr. Salem Testperson. Son Khalid Alharbi was informed.',
    ].join('\n');
    const t = out(note, 'أحمد الزهراني');
    for (const gone of ['أحمد', 'الزهراني', 'Ahmed', 'Zahrani', '1012345678', '2412345678', 'example.com', 'Salem', 'Khalid']) expect(t).not.toContain(gone);
    expect(t).toContain('palpitations');
  });
});

describe('the saved full name', () => {
  it('English, in any letter case', () => {
    expect(out('reviewed AHMED and zahrani', 'Ahmed Zahrani')).toBe('reviewed [NAME] and [NAME]');
  });
  it('does not corrupt an email', () => {
    const t = out('Mail ahmed@example.com', 'Ahmed Zahrani');
    expect(t).toBe('Mail [EMAIL]');
    expect(t).not.toContain('[NAME]@');
  });
  it('Arabic, also with spelling variants, diacritics or a joined letter', () => {
    expect(out('راجعنا فاطمة اليوم', 'فاطمة الحربي')).toBe('راجعنا [NAME] اليوم');
    expect(out('راجعنا فاطمه اليوم', 'فاطمة الحربي')).toBe('راجعنا [NAME] اليوم');
    expect(out('حضرت وفاطمة', 'فاطمة الحربي')).toBe('حضرت [NAME]');
    expect(out('راجعنا الحَربي', 'فاطمة الحربي')).toBe('راجعنا [NAME]');
    expect(out('راجعنا احمد', 'أحمد الحربي')).toBe('راجعنا [NAME]');
  });
  it('joins the parts of one name into one placeholder and counts one', () => {
    const r = redact('Faisal Testname reviewed', { mrn: '9990701', fullName: 'Faisal Testname' });
    expect(r.text).toBe('[NAME] reviewed');
    expect(r.removed.name).toBe(1);
  });
  it('a word inside a longer word stays, and connectors in the name are not removed from the note', () => {
    expect(out('Salemi visited', 'Salem Bin Ali')).toBe('Salemi visited');
    expect(out('ablation bin number 4', 'Salem Bin Ali')).toBe('ablation bin number 4');
    expect(out('[NAME] seen', 'Name Test')).toBe('[NAME] seen');
  });
  it('a hyphenated family name', () => {
    expect(out('Seen Al-Harbi and Harbi', 'Omar Al-Harbi')).toBe('Seen [NAME] and [NAME]');
  });
});

describe('redact keeps clinical content', () => {
  it.each([
    'LVEF 55%, mild LA dilatation. EF 30%.',
    'Apixaban 5 mg twice daily, furosemide 40 mg, cefazolin 2 g IV.',
    'INR 2.4. Creatinine 110. Hb 13.2. BP 120/80. HR 72 bpm. QRS 168 ms. PR 150 ms.',
    'Procedure 14 Sep 2026 09:20, elective. TEE on 13/09/2026: no thrombus. Discharged 2026-09-15.',
    'Echo 13 Sep 2026: LVEF 55%. ECG 3 Mar 2026: SVT at 180 bpm.',
    'Father had sudden cardiac death at 45. Mother Died Of Stroke. Brother With AF.',
    'Family history: son has WPW; daughter is well.',
    'DOB not available in the referral. Date of birth not documented.',
    'DOB 12/03/1961. D.O.B. 12-03-1961. Date of birth: 12 Mar 1961. Born in 1961.',
    'تاريخ الميلاد: 12/03/1961. مواليد 1961.',
    'Moderate MR. Mild MS. Severe TR.',
    'MR Moderate. MS Severe.',
    'Implanted an Azure DR MRI device; Evia DR.',
    'Drug name: Apixaban. Device name: Azure. Procedure name: PVI.',
    'Patient: Stable after the procedure.',
    'Patient tolerated the procedure well. Patient Stable Overnight.',
    'Patient-Reported Outcomes were collected.',
    'Hypertension 20 years. Diabetes Mellitus 10 years. Heart Failure 5 years.',
    'Atrial Fibrillation presented with fast rates. Sinus Rhythm was restored.',
    'Typical AVNRT, 30 y. Persistent AF, 67 M.',
    'Medtronic ICD implanted, lower rate 60 bpm, 3 leads. Serial not recorded.',
    'History: PVI with RF in March 2023 at KAMC. Procedure 1 Oct 2026.',
    'Newborn screening normal.',
    'ID consult requested. Contact 3 days later.',
    'الوالد توفي بموت قلبي مفاجئ. والده مصاب بالسكري. ابنه مصاب بمتلازمة وولف.',
    'الدكتور المعالج قرر الكي. المريض مستقر بعد الإجراء. المريض: مستقر.',
    'رجفان أذيني، 65 سنة. قصور القلب، 70 سنة.',
    'الكسر القذفي 55%. الجرعة 5 ملغ مرتين يوميا. بتاريخ 14/09/2026.',
    'اسم الدواء: أبيكسابان.',
  ])('%s', (note) => {
    expect(out(note)).toBe(note);
  });

  it('the name goes and the date of birth stays (owner, 4 Nov)', () => {
    expect(out('Name: Ahmed Zahrani. DOB 12/03/1961.')).toBe('Name: [NAME]. DOB 12/03/1961.');
    expect(out('Patient Sara Placeholder, DOB 15/11/1990, female')).toBe('Patient [NAME], DOB 15/11/1990, female');
  });

  it('the age stays when the name goes', () => {
    expect(out('Ahmed Alharbi, 65-year-old man')).toBe('[NAME], 65-year-old man');
  });
  it('a number next to the MRN is not taken for part of it', () => {
    expect(out('MRN 9990701 65-year-old man')).toBe('MRN [MRN] 65-year-old man');
    expect(mrnsInNote('MRN 9990701 65-year-old man')).toEqual(['9990701']);
  });
});

describe('MRNs in a note (the wrong-patient check)', () => {
  it('finds English and Arabic labels and Arabic digits', () => {
    expect(mrnsInNote('MRN 9990702')).toEqual(['9990702']);
    expect(mrnsInNote('رقم الملف: ٩٩٩٠٧٠٢')).toEqual(['9990702']);
    expect(mrnsInNote('الرقم الطبي 9990702')).toEqual(['9990702']);
    expect(mrnsInNote('MRN 999 07 02')).toEqual(['9990702']);
  });
});

describe('de-identifying twice changes nothing (the server repeats it on the edited text)', () => {
  it.each([
    'Name: Ahmed Zahrani. DOB 12/03/1961. MRN 9990701. National ID 1012345678. a.z@example.com 0551234567. Dr. Salem Testperson. Son Khalid Alharbi.',
    'الاسم: فاطمة الحربي. رقم الهوية 1012345678. تاريخ الميلاد 12/03/1961. د. أحمد الزهراني. ابنه خالد الحربي.',
    'Patient Sara Placeholder, DOB 15/11/1990, MRN 9990701, female.',
    'أحمد الزهراني، 65 سنة، رجفان أذيني',
  ])('%s', (note) => {
    const once = redact(note, known);
    const twice = redact(once.text, known);
    expect(twice.text).toBe(once.text);
    expect(twice.removed).toEqual({ mrn: 0, id: 0, email: 0, phone: 0, name: 0, instruction: 0 });
  });
});

describe('every made-up sample note', () => {
  it.each(fixtures.map((f) => [f.id, f] as const))('%s: identifiers go, every quote the AI needs stays', (_id, fx) => {
    const r = redact(fx.text.join('\n'), { mrn: fx.identifiers.mrn, fullName: fx.identifiers.name });
    const note = normalizeForQuote(r.text);
    for (const part of fx.identifiers.name.split(' ')) expect(r.text).not.toContain(part);
    expect(r.text).not.toContain(fx.identifiers.mrn);
    for (const e of fx.expected) expect(note).toContain(normalizeForQuote(String(e[3])));
  });
  it.each(fixtures.map((f) => [f.id, f] as const))('%s: identifiers go even with no saved name', (_id, fx) => {
    const r = redact(fx.text.join('\n'), { mrn: '0000000' });
    for (const part of fx.identifiers.name.split(' ')) expect(r.text).not.toContain(part);
  });
});
