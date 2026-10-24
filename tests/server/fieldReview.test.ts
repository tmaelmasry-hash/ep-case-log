// Owner field review (24 Oct 2026): config/case_layout.json "form" hides fields, drops core items, relabels and
// reorders choices — the dictionary itself is untouched. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { loadConfig, readRawConfig } from '../../server/dictionary.ts';
import { buildDictionary, editable, formFields, offeredCodes, type RawDictionary } from '../../shared/dictionary.ts';
import { encodeValue } from '../../shared/validate.ts';

const { dict } = loadConfig();
const def = (e: string) => dict.entities[e];
const field = (e: string, f: string) => def(e).fields.find((x) => x.name === f)!;
const shown = (e: string) => formFields(def(e)).map((f) => f.name);

describe('field review (case_layout form)', () => {
  it('hidden fields leave the form and the core list; the dictionary field and its column stay', () => {
    expect(field('EP_PROCEDURES', 'care_setting')).toBeDefined();
    expect(shown('EP_PROCEDURES')).not.toContain('care_setting');
    expect(shown('EP_PROCEDURES')).not.toContain('scheduled_date');
    expect(shown('EP_PROCEDURES')).toContain('anesthesia');
    expect(dict.core.has('EP_PROCEDURES.care_setting')).toBe(false);
    expect(dict.core.has('EP_EPISODES.hajj_timing')).toBe(false);
    expect(dict.core.has('EP_PROCEDURES.urgency')).toBe(false); // not_core: still shown, no longer required
    expect(shown('EP_PROCEDURES')).toContain('urgency');
    expect(dict.core.has('EP_PROCEDURES.primary_procedure_type')).toBe(true);
  });

  it('a hidden text field cannot be edited; a hidden link stays writable for the app', () => {
    expect(editable(def('EP_PROCEDURES'), field('EP_PROCEDURES', 'care_setting'))).toBe(false);
    expect(editable(def('OUTCOME_EVENTS'), field('OUTCOME_EVENTS', 'followup_id'))).toBe(true);
    expect(shown('OUTCOME_EVENTS')).not.toContain('followup_id');
  });

  it('labels, choice order, offered choices and date-only', () => {
    expect(field('PATIENTS', 'sex_at_birth').label).toBe('Sex');
    expect(field('PATIENTS', 'sex_at_birth').codes!.map((c) => c.code)).toEqual(['MALE', 'FEMALE']);
    expect(field('MEDICATION_RECORDS', 'antiarrhythmic').codes!.slice(0, 4).map((c) => c.code)).toEqual(['NONE', 'BETA_BLOCKER_ONLY', 'NONDIHYDROPYRIDINE_CCB_ONLY', 'AMIODARONE']);
    expect(offeredCodes(field('EP_PROCEDURES', 'procedure_status'))).toEqual(['COMPLETED', 'PARTIAL', 'FAILED']);
    expect(offeredCodes(field('EP_PROCEDURES', 'procedure_status'), { procedure_status: 'SCHEDULED' })).toContain('SCHEDULED'); // a saved value still shows
    const date = field('EP_PROCEDURES', 'procedure_start_datetime');
    expect(date).toMatchObject({ type: 'date', label: 'Procedure date' });
    expect(encodeValue(date, '2026-09-14', {})).toBe('2026-09-14');
    expect(encodeValue(date, '2026-09-14T09:20', {})).toBe('2026-09-14'); // an older device may still send a time
  });

  it('phase 3: KAMC amendments replace nationality, residence, valve lesion and scar location on the form', () => {
    expect(shown('PATIENTS')).toEqual(expect.arrayContaining(['nationality_code', 'residence_category']));
    expect(shown('PATIENTS')).not.toContain('nationality');
    expect(shown('PATIENTS')).not.toContain('residence_status');
    expect(field('PATIENTS', 'nationality_code').codes![0].code).toBe('SAUDI_ARABIA');
    expect(field('PATIENTS', 'residence_category').codes!.map((c) => c.code)).toEqual(['SAUDI_CITIZEN', 'RESIDENT', 'INTERNATIONAL_VISITOR']);
    const valve = field('ECHO_STUDIES', 'significant_valve_lesions');
    expect(valve).toMatchObject({ type: 'lookup_array', exclusive: ['NONE'] });
    expect(valve.codes!.map((c) => c.code)).not.toContain('MULTIPLE_SIGNIFICANT_LESIONS');
    expect(shown('ECHO_STUDIES')).not.toContain('significant_valve_lesion');
    expect(field('ADVANCED_IMAGING', 'scar_locations').type).toBe('lookup_array');
    const rm = shown('RHYTHM_MONITORING');
    expect(rm.indexOf('pac_burden_pct')).toBe(rm.indexOf('pvc_burden_pct') + 1);
    expect(offeredCodes(field('RHYTHM_MONITORING', 'monitor_type'))).toContain('INPATIENT_MONITOR');
    expect(field('RHYTHM_MONITORING', 'nsvt_or_vt_detected').label).toBe('NSVT / VT detected');
    expect(def('PATIENTS').copy_forward).toEqual(expect.arrayContaining(['nationality_code', 'residence_category']));
    expect(encodeValue(valve, ['MITRAL_STENOSIS_SEVERE', 'TRICUSPID_REGURGITATION_MODERATE'], {})).toBe('["MITRAL_STENOSIS_SEVERE","TRICUSPID_REGURGITATION_MODERATE"]');
  });

  it('start-up check: a field or code that is not in the dictionary stops the build', () => {
    const raw = readRawConfig();
    const withForm = (form: object): RawDictionary => ({ ...raw, layout: { ...raw.layout, form } });
    expect(() => buildDictionary(withForm({ hidden: ['EP_PROCEDURES.no_such_field'] }))).toThrow(/not a dictionary field/);
    expect(() => buildDictionary(withForm({ offer: { 'EP_PROCEDURES.procedure_status': ['DONE'] } }))).toThrow(/not a code/);
    expect(() => buildDictionary(withForm({ date_only: ['EP_PROCEDURES.urgency'] }))).toThrow(/not a date & time field/);
  });
});
