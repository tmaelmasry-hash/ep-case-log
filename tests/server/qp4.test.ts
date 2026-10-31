// R4-5 / Q-P4 (owner 31 Oct): which device types, lead types and CSP strategies show the pacing, ICD and CSP
// questions (docs/MERGE_PLAN.md). Lower rate, tachytherapy status, pulse width and CSP target are hidden by the field
// review (24 Oct); their rules only matter if one is shown again. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../server/dictionary.ts';
import { applyEdits, expectedSlot, newCaseRecord } from '../../server/domain/cases.ts';
import { idPrefix, type CaseRecord } from '../../shared/caseTypes.ts';

const { dict } = loadConfig();
const rid = (entity: string) => `${idPrefix(dict.entities[entity].pk)}_${crypto.randomUUID()}`;
const a = { userId: 'u1', now: '2026-10-31T08:00:00Z' };
const users = new Set(['u1']);

function makeCase() {
  return newCaseRecord(dict, { caseId: `case_${crypto.randomUUID()}`, patientId: `patient_${crypto.randomUUID()}`, mrn: '9990451', groupId: 'grp_1', groupSeq: 1, episodeStart: '2026-10-01', enrollmentDate: '2026-10-31', registryBasis: 'CLINICAL_QI' }, a);
}
function device(type: string, action: string, component = 'DEVICE_IMPLANT') {
  const rec = makeCase();
  const pid = rid('EP_PROCEDURES');
  const di = expectedSlot(dict, 'DEVICE_IMPLANTS', pid);
  const res = applyEdits(
    dict,
    rec,
    {
      creates: [
        { entity: 'DEVICES', id: expectedSlot(dict, 'DEVICES', rec.meta.case_id), values: { current_device_type: type } },
        { entity: 'EP_PROCEDURES', id: pid, values: { primary_procedure_type: 'CIED_IMPLANT' } },
        { entity: 'PROCEDURE_COMPONENTS', id: rid('PROCEDURE_COMPONENTS'), parent_id: pid, values: { component_type: component } },
        { entity: 'DEVICE_IMPLANTS', id: di, parent_id: pid, values: { device_action: action } },
      ],
    },
    a,
    users,
  );
  expect(res.every((r) => r.ok), JSON.stringify(res)).toBe(true);
  return { rec, di, pid };
}
const tryField = (rec: CaseRecord, entity: string, id: string, field: string, value: unknown) => applyEdits(dict, rec, { changes: [{ entity, id, field, value }] }, a, users)[0].ok;
const shows = (type: string, action: string, field: string, value: unknown) => {
  const { rec, di } = device(type, action);
  return tryField(rec, 'DEVICE_IMPLANTS', di, field, value);
};

describe('Q-P4 device capability', () => {
  it('programmed mode and lower rate: pacing devices, not S-ICD / EV-ICD / LVEP / CCM / ILR, not a pure explant', () => {
    for (const t of ['PPM_SINGLE', 'PPM_DUAL', 'CRT_P', 'ICD_SINGLE', 'ICD_DUAL', 'CRT_D', 'LEADLESS_SINGLE', 'LEADLESS_DUAL', 'OTHER']) {
      expect(shows(t, 'NEW_IMPLANT', 'final_programmed_mode', 'DDD'), t).toBe(true);
      expect(shows(t, 'GENERATOR_CHANGE', 'final_programmed_mode', 'VVI'), t).toBe(true);
    }
    for (const t of ['S_ICD', 'EV_ICD', 'LEADLESS_LVEP', 'CCM', 'ILR']) {
      expect(shows(t, 'NEW_IMPLANT', 'final_programmed_mode', 'DDD'), t).toBe(false);
    }
    expect(shows('PPM_DUAL', 'EXPLANT', 'final_programmed_mode', 'DDD')).toBe(false);
  });

  it('defibrillation testing: ICD-capable systems only', () => {
    for (const t of ['ICD_SINGLE', 'ICD_DUAL', 'CRT_D', 'S_ICD', 'EV_ICD', 'OTHER']) {
      expect(shows(t, 'NEW_IMPLANT', 'defibrillation_testing', 'NOT_DONE'), t).toBe(true);
    }
    for (const t of ['PPM_DUAL', 'CRT_P', 'LEADLESS_SINGLE', 'LEADLESS_LVEP', 'CCM', 'ILR']) {
      expect(shows(t, 'NEW_IMPLANT', 'defibrillation_testing', 'NOT_DONE'), t).toBe(false);
    }
  });
});

describe('Q-P4 lead capability', () => {
  const lead = (type: string) => {
    const rec = makeCase();
    const id = rid('DEVICE_LEADS');
    const r = applyEdits(dict, rec, { creates: [{ entity: 'DEVICE_LEADS', id, values: { lead_type: type } }] }, a, users);
    expect(r.every((x) => x.ok), JSON.stringify(r)).toBe(true);
    return (field: string, value: unknown) => tryField(rec, 'DEVICE_LEADS', id, field, value);
  };
  it('threshold and pacing impedance for pacing leads (transvenous defibrillation too); shock impedance for defibrillation leads', () => {
    for (const t of ['PACE_SENSE', 'LV', 'CSP', 'EPICARDIAL', 'TRANSVENOUS_DEFIBRILLATION', 'OTHER']) {
      const set = lead(t);
      expect([set('acute_capture_threshold_v', 0.75), set('acute_impedance_ohm', 600)], t).toEqual([true, true]);
    }
    const ev = lead('EXTRAVASCULAR_DEFIBRILLATION');
    expect([ev('acute_capture_threshold_v', 0.75), ev('acute_impedance_ohm', 600), ev('shock_impedance_ohm', 70)]).toEqual([false, false, true]);
    expect(lead('TRANSVENOUS_DEFIBRILLATION')('shock_impedance_ohm', 50)).toBe(true);
    expect(lead('PACE_SENSE')('shock_impedance_ohm', 50)).toBe(false);
    expect(lead('PACE_SENSE')('acute_sensing_mv', 8)).toBe(true); // sensing stays for every lead
  });
});

describe('Q-P4 CSP strategies', () => {
  it('the four fields the field review hid stay hidden', () => {
    expect(shows('PPM_DUAL', 'NEW_IMPLANT', 'lower_rate_bpm', 60)).toBe(false);
    expect(shows('ICD_DUAL', 'NEW_IMPLANT', 'tachytherapy_status', 'ENABLED')).toBe(false);
  });
  it('conduction-system capture documented for HBP, LBBAP, HOT-CRT and LOT-CRT, not BIV CRT', () => {
    for (const [s, want] of [['HBP', true], ['LBBAP', true], ['HOT_CRT', true], ['LOT_CRT', true], ['BIV_CRT', false]] as const) {
      const { rec, pid } = device('CRT_D', 'NEW_IMPLANT', 'CRT_CSP');
      const cid = expectedSlot(dict, 'CRT_CSP_PROCEDURES', pid);
      const r = applyEdits(dict, rec, { creates: [{ entity: 'CRT_CSP_PROCEDURES', id: cid, parent_id: pid, values: { cpp_strategy: s } }] }, a, users);
      expect(r.every((x) => x.ok), JSON.stringify(r)).toBe(true);
      expect(tryField(rec, 'CRT_CSP_PROCEDURES', cid, 'conduction_system_capture_documented', 'YES'), s).toBe(want);
    }
  });
});

describe('DR-DV-06 leadless channel measurements (owner 31 Oct)', () => {
  it('a channel row can be added for a leadless single / dual device only', () => {
    for (const [t, want] of [['LEADLESS_SINGLE', true], ['LEADLESS_DUAL', true], ['PPM_DUAL', false], ['ICD_DUAL', false]] as const) {
      const { rec, di } = device(t, 'NEW_IMPLANT');
      const r = applyEdits(dict, rec, { creates: [{ entity: 'DEVICE_IMPLANT_CHANNEL_MEASUREMENTS', id: rid('DEVICE_IMPLANT_CHANNEL_MEASUREMENTS'), parent_id: di }] }, a, users)[0];
      expect(r.ok, `${t} ${r.message ?? ''}`).toBe(want);
      if (!want) expect(r.message).toMatch(/does not apply to this device type/);
    }
  });
});
