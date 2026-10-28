// Sidebar categories (owner R2-4 / R2-5): config uses only dictionary codes, the server reports the codes of each
// procedure, and the matcher puts a case under the right items. Synthetic MRNs (9990xxx) only.
import { describe, expect, it } from 'vitest';
import categories from '../../config/categories.json' with { type: 'json' };
import { loadConfig } from '../../server/dictionary.ts';
import { applyEdits, expectedSlot, newCaseRecord, summarize } from '../../server/domain/cases.ts';
import { followupState } from '../../server/domain/followups.ts';
import { CategoryMatcher, UNCLASSIFIED, hijriYear, type CategoryConfig } from '../../shared/categories.ts';
import { idPrefix, type CaseSummary } from '../../shared/caseTypes.ts';

const { dict, site } = loadConfig();
const cfg = categories as unknown as CategoryConfig;
const m = new CategoryMatcher(cfg);
const rid = (entity: string) => `${idPrefix(dict.entities[entity].pk)}_${crypto.randomUUID()}`;
const a = { userId: 'u1', now: '2026-10-23T08:00:00Z' };

function makeCase(episodeStart = '2026-06-05') {
  return newCaseRecord(dict, { caseId: `case_${crypto.randomUUID()}`, patientId: `patient_${crypto.randomUUID()}`, mrn: '9990101', groupId: 'grp_1', groupSeq: 1, episodeStart, enrollmentDate: '2026-10-22', registryBasis: 'CLINICAL_QI' }, a);
}
function addProcedure(rec: ReturnType<typeof makeCase>, components: string[], values: Record<string, unknown> = {}, rows: { entity: string; values: Record<string, unknown> }[] = []) {
  const pid = rid('EP_PROCEDURES');
  const res = applyEdits(
    dict,
    rec,
    {
      creates: [
        { entity: 'EP_PROCEDURES', id: pid, values },
        ...components.map((t) => ({ entity: 'PROCEDURE_COMPONENTS', id: rid('PROCEDURE_COMPONENTS'), parent_id: pid, values: { component_type: t } })),
        ...rows.map((r) => ({ entity: r.entity, id: expectedSlot(dict, r.entity, pid), parent_id: pid, values: r.values })),
      ],
    },
    a,
    new Set(['u1']),
  );
  expect(res.every((r) => r.ok), JSON.stringify(res)).toBe(true);
  return pid;
}
const tags = (s: CaseSummary) => m.tagsOf(s);

describe('category config', () => {
  it('uses only dictionary fields and codes (with the owner-approved amendments)', () => {
    const exists = (field: string, code: string) => {
      const [e, f] = field.split('.');
      return !!dict.entities[e]?.fields.find((x) => x.name === f)?.codes?.some((c) => c.code === code);
    };
    expect(m.check(exists)).toEqual([]);
    expect(cfg.pending_codes).toBeUndefined();
  });

  it('has the owner-approved main menus in order', () => {
    expect(m.children(null).filter((i) => i.section === 'procedures').map((i) => i.label)).toEqual(['Ablation', 'Devices', 'Diagnostic', 'Structural']);
    expect(m.children('ABLATION').map((i) => i.label)).toEqual(['AF ablation', 'Flutter ablation', 'SVT ablation', 'Accessory pathway ablation', 'AV node ablation', 'Ventricular ablation']);
    expect(m.children('DEV').map((i) => i.label)).toEqual(['Pacemaker', 'ICD', 'CRT', 'Conduction system pacing', 'Extraction and revision', 'Generator change and upgrade']);
    expect(m.children('DEV_ICD').map((i) => i.label)).toEqual(['Single chamber', 'Dual chamber', 'Subcutaneous ICD', 'EV-ICD']);
  });
});

describe('matching', () => {
  it('a case with AF (redo) and typical flutter sits under both, with its parents', () => {
    const rec = makeCase();
    addProcedure(rec, ['AF', 'FLUTTER'], { primary_procedure_type: 'ABLATION', first_or_redo: 'REDO' }, [{ entity: 'FLUTTER_ABLATIONS', values: { flutter_type: 'TYPICAL_CTI' } }]);
    const t = tags(summarize(dict, rec));
    for (const id of ['ABLATION', 'AF', 'AF_REDO', 'FLUTTER', 'FLUTTER_TYPICAL']) expect(t.has(id), id).toBe(true);
    for (const id of ['AF_FIRST', 'FLUTTER_ATYPICAL', 'SVT', 'DEV', UNCLASSIFIED]) expect(t.has(id), id).toBe(false);
  });

  it('first/redo belongs to the AF procedure itself, not to another procedure of the case', () => {
    const rec = makeCase();
    addProcedure(rec, ['AF'], { primary_procedure_type: 'ABLATION', first_or_redo: 'FIRST' });
    addProcedure(rec, ['AVNRT'], { primary_procedure_type: 'ABLATION', first_or_redo: 'REDO' });
    const t = tags(summarize(dict, rec));
    expect([t.has('AF_FIRST'), t.has('AF_REDO'), t.has('SVT_AVNRT'), t.has('SVT')]).toEqual([true, false, true, true]);
  });

  it('accessory pathway is its own menu, not SVT', () => {
    const rec = makeCase();
    addProcedure(rec, ['AVRT_WPW'], { primary_procedure_type: 'ABLATION' });
    applyEdits(dict, rec, { creates: [{ entity: 'SVT_ABLATIONS', id: expectedSlot(dict, 'SVT_ABLATIONS', rec.rows.EP_PROCEDURES[0]._id), parent_id: rec.rows.EP_PROCEDURES[0]._id, values: { accessory_pathway_manifestation: 'CONCEALED' } }] }, a, new Set(['u1']));
    const t = tags(summarize(dict, rec));
    expect([t.has('AP'), t.has('AP_CONCEALED'), t.has('AP_MANIFEST'), t.has('SVT')]).toEqual([true, true, false, false]);
  });

  it('device type needs a device procedure in the case: an AF ablation in an ICD patient is not an ICD case', () => {
    const rec = makeCase();
    applyEdits(dict, rec, { creates: [{ entity: 'DEVICES', id: expectedSlot(dict, 'DEVICES', rec.meta.case_id), values: { current_device_type: 'ICD_DUAL' } }] }, a, new Set(['u1']));
    addProcedure(rec, ['AF'], { primary_procedure_type: 'ABLATION' });
    expect(tags(summarize(dict, rec)).has('DEV_ICD_DUAL')).toBe(false);
    addProcedure(rec, ['DEVICE_IMPLANT'], { primary_procedure_type: 'CIED_IMPLANT' });
    const t = tags(summarize(dict, rec));
    expect([t.has('DEV'), t.has('DEV_ICD'), t.has('DEV_ICD_DUAL'), t.has('DEV_ICD_S')]).toEqual([true, true, true, false]);
  });

  it('SVT splits AVNRT into typical / atypical and AT into focal / macro-reentrant (owner, 23 Oct)', () => {
    const rec = makeCase();
    addProcedure(rec, ['AVNRT'], { primary_procedure_type: 'ABLATION' }, [{ entity: 'SVT_ABLATIONS', values: { svt_mechanism: 'ATYPICAL_AVNRT' } }]);
    const t = tags(summarize(dict, rec));
    expect([t.has('SVT'), t.has('SVT_AVNRT'), t.has('SVT_AVNRT_ATYP'), t.has('SVT_AVNRT_TYP'), t.has('SVT_AT'), t.has('SVT_OTHER')]).toEqual([true, true, true, false, false, false]);
  });

  it('fascicular VT comes from the origin field; ILR sits under Diagnostic, not Devices', () => {
    const rec = makeCase();
    addProcedure(rec, ['VT_VF'], { primary_procedure_type: 'ABLATION' }, [{ entity: 'VENTRICULAR_ABLATIONS', values: { va_type: 'IDIOPATHIC_SUSTAINED_VT', dominant_origin_or_substrate_location: 'FASCICULAR' } }]);
    addProcedure(rec, ['ILR'], { primary_procedure_type: 'ILR' });
    const t = tags(summarize(dict, rec));
    expect([t.has('VENT_FASC'), t.has('VENT_IDIO'), t.has('DIAG'), t.has('DIAG_ILR'), t.has('DEV')]).toEqual([true, true, true, true, false]);
  });

  it('scar VT splits by substrate', () => {
    const rec = makeCase();
    addProcedure(rec, ['VT_VF'], { primary_procedure_type: 'ABLATION' }, [{ entity: 'VENTRICULAR_ABLATIONS', values: { va_type: 'SCAR_MONOMORPHIC_VT', structural_substrate: 'ISCHEMIC_CM' } }]);
    const t = tags(summarize(dict, rec));
    expect([t.has('VENT'), t.has('VENT_SCAR'), t.has('VENT_SCAR_ISCH'), t.has('VENT_SCAR_NONISCH'), t.has('VENT_PVC')]).toEqual([true, true, true, false, false]);
  });

  it('a case with no procedure is Unclassified and Incomplete', () => {
    const t = tags(summarize(dict, makeCase()));
    expect([t.has(UNCLASSIFIED), t.has('INCOMPLETE'), t.has('PILGRIM_NOT_RECORDED')]).toEqual([true, true, true]);
    // Owner 28 Oct: "Pilgrims" counts Hajj + Umrah only, not Not recorded or Non-pilgrim.
    expect(t.has('PILGRIMS')).toBe(false);
    const rec = makeCase();
    applyEdits(dict, rec, { changes: [{ entity: 'EP_EPISODES', id: rec.meta.episode_id, field: 'pilgrim_status', value: 'NON_PILGRIM' }] }, a, new Set(['u1']));
    const n = tags(summarize(dict, rec));
    expect([n.has('NON_PILGRIM'), n.has('PILGRIMS')]).toEqual([true, false]);
  });

  it('pilgrims come from pilgrim_status as entered; the year comes from the episode date (Hajj: Muharram counts back)', () => {
    const rec = makeCase('2026-06-17'); // 1 Muharram 1448
    applyEdits(dict, rec, { changes: [{ entity: 'EP_EPISODES', id: rec.meta.episode_id, field: 'pilgrim_status', value: 'HAJJ' }] }, a, new Set(['u1']));
    const t = tags(summarize(dict, rec));
    expect([t.has('PILGRIMS'), t.has('HAJJ'), t.has('HAJJ@1447'), t.has('UMRAH'), t.has('PILGRIM_NOT_RECORDED')]).toEqual([true, true, true, false, false]);
    expect(m.yearsOf('HAJJ', [t])).toEqual([1447]);
  });
});

describe('hijri year', () => {
  it('uses Umm al-Qura; only the Hajj rule moves Muharram back', () => {
    expect(hijriYear('2026-05-27', 'hajj')).toBe(1447); // Dhu al-Hijjah 1447
    expect(hijriYear('2026-06-17', 'hajj')).toBe(1447); // 1 Muharram 1448
    expect(hijriYear('2026-06-17', 'hijri')).toBe(1448);
    expect(hijriYear('2026-10-23', 'hajj')).toBe(1448);
    expect(hijriYear(null, 'hijri')).toBe(null);
  });
});

describe('follow-up state', () => {
  it('is reported while the bell stays switched off', () => {
    expect(site.followup_due?.enabled).toBe(false);
    const rec = makeCase('2026-09-01');
    addProcedure(rec, ['AF'], { primary_procedure_type: 'ABLATION', procedure_start_datetime: '2026-09-20T09:00' });
    const state = followupState(site.followup_due, [rec], '2026-10-23').get(rec.meta.case_id);
    expect(state).toBe('OVERDUE'); // D30 visit was due 2026-10-20
    expect(tags(summarize(dict, rec, state)).has('FOLLOWUP_OVERDUE')).toBe(true);
  });
});
