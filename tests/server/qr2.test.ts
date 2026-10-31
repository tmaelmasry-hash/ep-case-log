// Q-R2 (owner 31 Oct): atypical flutter target for atypical flutter only; extraction details for extraction and
// complete system explant only (docs/MERGE_PLAN.md). Synthetic data only.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../server/dictionary.ts';
import { applyEdits, expectedSlot, newCaseRecord } from '../../server/domain/cases.ts';
import { idPrefix } from '../../shared/caseTypes.ts';

const { dict } = loadConfig();
const rid = (entity: string) => `${idPrefix(dict.entities[entity].pk)}_${crypto.randomUUID()}`;
const a = { userId: 'u1', now: '2026-10-31T10:00:00Z' };
const users = new Set(['u1']);

/** A case with one procedure of `component` and its module row holding `values`; returns a setter for that row. */
function moduleRow(component: string, type: string, entity: string, values: Record<string, unknown>, device = false) {
  const rec = newCaseRecord(dict, { caseId: `case_${crypto.randomUUID()}`, patientId: `patient_${crypto.randomUUID()}`, mrn: '9990481', groupId: 'grp_1', groupSeq: 1, episodeStart: '2026-10-01', enrollmentDate: '2026-10-31', registryBasis: 'CLINICAL_QI' }, a);
  const pid = rid('EP_PROCEDURES');
  const id = expectedSlot(dict, entity, pid);
  const res = applyEdits(
    dict,
    rec,
    {
      creates: [
        ...(device ? [{ entity: 'DEVICES', id: expectedSlot(dict, 'DEVICES', rec.meta.case_id), values: { current_device_type: 'PPM_DUAL' } }] : []),
        { entity: 'EP_PROCEDURES', id: pid, values: { primary_procedure_type: type } },
        { entity: 'PROCEDURE_COMPONENTS', id: rid('PROCEDURE_COMPONENTS'), parent_id: pid, values: { component_type: component } },
        { entity, id, parent_id: pid, values },
      ],
    },
    a,
    users,
  );
  expect(res.every((r) => r.ok), JSON.stringify(res)).toBe(true);
  return (field: string, value: unknown) => applyEdits(dict, rec, { changes: [{ entity, id, field, value }] }, a, users)[0].ok;
}

describe('Q-R2 show rules', () => {
  it('atypical flutter target: atypical RA / LA only', () => {
    for (const [t, want] of [['ATYPICAL_RA', true], ['ATYPICAL_LA', true], ['TYPICAL_CTI', false], ['REVERSE_TYPICAL_CTI', false], ['UNKNOWN', false]] as const) {
      const set = moduleRow('FLUTTER', 'ABLATION', 'FLUTTER_ABLATIONS', { flutter_type: t });
      expect(set('atypical_flutter_target', 'MITRAL_ISTHMUS_LINE'), t).toBe(want);
    }
  });

  it('extraction details: extraction and complete system explant only', () => {
    for (const [t, want] of [['EXTRACT', true], ['COMPLETE_SYSTEM_EXPLANT', true], ['REVISION', false], ['REPOSITION', false], ['POCKET_REVISION', false]] as const) {
      const set = moduleRow('LEAD_MANAGEMENT', 'EXTRACTION', 'LEAD_PROCEDURES', { lead_management_type: t }, true);
      expect([set('extraction_approach', 'MECHANICAL_SHEATH'), set('extraction_result', 'COMPLETE_PROCEDURAL_SUCCESS'), set('retained_fragment', 'NO'), set('surgical_rescue_required', false)], t).toEqual([want, want, want, want]);
    }
  });
});
