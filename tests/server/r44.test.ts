// R4-4 (owner 30 Oct): several NCDR pacing reasons and generator-replacement reasons beside the unchanged implant
// indication; old cases get a reason only for an exact match. Runs on the memory store and the Sheet store.
// Synthetic MRNs (9990xxx) and synthetic accounts only.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../server/dictionary.ts';
import { applyEdits, expectedSlot, newCaseRecord } from '../../server/domain/cases.ts';
import { migrateR44, R44_ACTOR } from '../../server/domain/r44.ts';
import { idPrefix, type CaseRecord } from '../../shared/caseTypes.ts';
import { encodeValue } from '../../shared/validate.ts';
import { makeTestStore } from './storeFactory.ts';

const { dict } = loadConfig();
const field = (f: string) => dict.entities.DEVICE_IMPLANTS.fields.find((x) => x.name === f)!;
const rid = (entity: string) => `${idPrefix(dict.entities[entity].pk)}_${crypto.randomUUID()}`;
const a = { userId: 'u1', now: '2026-10-30T20:00:00Z' };
const users = new Set(['u1']);

function deviceCase(type: string, action: string, indication: string | null) {
  const rec = newCaseRecord(dict, { caseId: `case_${crypto.randomUUID()}`, patientId: `patient_${crypto.randomUUID()}`, mrn: '9990441', groupId: 'grp_1', groupSeq: 1, episodeStart: '2026-10-01', enrollmentDate: '2026-10-30', registryBasis: 'CLINICAL_QI' }, a);
  const pid = rid('EP_PROCEDURES');
  const di = expectedSlot(dict, 'DEVICE_IMPLANTS', pid);
  const res = applyEdits(
    dict,
    rec,
    {
      creates: [
        { entity: 'DEVICES', id: expectedSlot(dict, 'DEVICES', rec.meta.case_id), values: { current_device_type: type } },
        { entity: 'EP_PROCEDURES', id: pid, values: { primary_procedure_type: 'CIED_IMPLANT' } },
        { entity: 'PROCEDURE_COMPONENTS', id: rid('PROCEDURE_COMPONENTS'), parent_id: pid, values: { component_type: 'DEVICE_IMPLANT' } },
        { entity: 'DEVICE_IMPLANTS', id: di, parent_id: pid, values: { device_action: action, ...(indication ? { implant_indication: indication } : {}) } },
      ],
    },
    a,
    users,
  );
  expect(res.every((r) => r.ok), JSON.stringify(res)).toBe(true);
  return { rec, di };
}
const set = (rec: CaseRecord, di: string, f: string, value: unknown) => applyEdits(dict, rec, { changes: [{ entity: 'DEVICE_IMPLANTS', id: di, field: f, value }] }, a, users)[0];

describe('R4-4 fields', () => {
  it('two optional multi-choice fields right after implant indication, with the NCDR printed reasons; the old field is unchanged', () => {
    const names = dict.entities.DEVICE_IMPLANTS.fields.map((f) => f.name);
    expect(names.slice(names.indexOf('implant_indication'), names.indexOf('implant_indication') + 3)).toEqual(['implant_indication', 'pacing_indication_reasons', 'generator_replacement_reasons']);
    expect(field('implant_indication')).toMatchObject({ type: 'enum', req: 'R' });
    for (const f of ['pacing_indication_reasons', 'generator_replacement_reasons']) expect(field(f)).toMatchObject({ type: 'lookup_array', req: 'O' });
    expect(field('pacing_indication_reasons').codes!.map((c) => c.label)).toEqual(['2:1 AV block', '2nd degree Mobitz II', 'AV node ablation', 'Anticipated >40% RV pacing', 'Chronotropic incompetence', 'Complete heart block', 'HF unresponsive to GDMT', 'Sick sinus syndrome', 'Other']);
    expect(field('generator_replacement_reasons').codes!.map((c) => c.label)).toEqual(['Device relocation', 'End of battery life', 'Faulty connector / header', 'Infection', 'Malfunction', 'Replaced at lead revision', 'Manufacturer advisory / recall', 'Upgrade', 'Other']);
    expect(encodeValue(field('generator_replacement_reasons'), ['MANUFACTURER_ADVISORY_RECALL', 'END_OF_BATTERY_LIFE'], {})).toBe('["END_OF_BATTERY_LIFE","MANUFACTURER_ADVISORY_RECALL"]');
  });

  it('pacing reasons show for pacing devices (leadless too), not for an ICD without pacing leads', () => {
    for (const t of ['PPM_DUAL', 'CRT_D', 'ICD_DUAL', 'LEADLESS_SINGLE']) {
      const { rec, di } = deviceCase(t, 'NEW_IMPLANT', 'AV_BLOCK');
      expect(set(rec, di, 'pacing_indication_reasons', ['COMPLETE_HEART_BLOCK', 'CHRONOTROPIC_INCOMPETENCE']), t).toMatchObject({ ok: true });
    }
    const icd = deviceCase('ICD_SINGLE', 'NEW_IMPLANT', 'PRIMARY_SCD_PREVENTION');
    expect(set(icd.rec, icd.di, 'pacing_indication_reasons', ['COMPLETE_HEART_BLOCK'])).toMatchObject({ ok: false, message: expect.stringMatching(/does not apply/) });
  });

  it('replacement reasons show for a generator change, upgrade, downgrade or explant, not for a new implant', () => {
    const gc = deviceCase('PPM_DUAL', 'GENERATOR_CHANGE', 'REPLACEMENT_ERI_EOL');
    expect(set(gc.rec, gc.di, 'generator_replacement_reasons', ['END_OF_BATTERY_LIFE', 'MANUFACTURER_ADVISORY_RECALL'])).toMatchObject({ ok: true });
    const fresh = deviceCase('PPM_DUAL', 'NEW_IMPLANT', 'SND');
    expect(set(fresh.rec, fresh.di, 'generator_replacement_reasons', ['UPGRADE'])).toMatchObject({ ok: false });
  });

  it('"Other" keeps its own specify text', () => {
    const { rec, di } = deviceCase('PPM_DUAL', 'GENERATOR_CHANGE', 'OTHER');
    expect(set(rec, di, 'generator_replacement_reasons', ['OTHER'])).toMatchObject({ ok: true });
    const r = applyEdits(dict, rec, { changes: [{ entity: 'DEVICE_IMPLANTS', id: di, field: 'other_specify_json', key: 'generator_replacement_reasons', value: 'Pocket pain' }] }, a, users)[0];
    expect(r).toMatchObject({ ok: true });
    expect(JSON.parse(String(rec.rows.DEVICE_IMPLANTS[0].other_specify_json))).toMatchObject({ generator_replacement_reasons: 'Pocket pain' });
  });
});

describe('R4-4 migration (exact matches only)', () => {
  it('copies ERI/EOL, post AVJ ablation and SND; leaves AV block, filled rows, AI values and deleted cases; a second run does nothing', async () => {
    const store = await makeTestStore();
    const eri = deviceCase('PPM_DUAL', 'GENERATOR_CHANGE', 'REPLACEMENT_ERI_EOL');
    const avj = deviceCase('PPM_SINGLE', 'NEW_IMPLANT', 'POST_AVJ_ABLATION');
    const snd = deviceCase('PPM_DUAL', 'NEW_IMPLANT', 'SND');
    const avb = deviceCase('PPM_DUAL', 'NEW_IMPLANT', 'AV_BLOCK');
    const done = deviceCase('PPM_DUAL', 'NEW_IMPLANT', 'SND');
    set(done.rec, done.di, 'pacing_indication_reasons', ['CHRONOTROPIC_INCOMPETENCE']);
    const ai = deviceCase('PPM_DUAL', 'NEW_IMPLANT', 'SND');
    ai.rec.ai = { [`DEVICE_IMPLANTS|${ai.di}|implant_indication`]: { source: 'AI', entity: 'DEVICE_IMPLANTS', record_id: ai.di, field: 'implant_indication', evidence: null, at: a.now, by: 'u1' } };
    const icd = deviceCase('ICD_SINGLE', 'NEW_IMPLANT', 'SND'); // SND on an ICD without pacing: the rule hides the field
    const gone = deviceCase('PPM_DUAL', 'NEW_IMPLANT', 'SND');
    gone.rec.meta.is_deleted = true;
    for (const c of [eri, avj, snd, avb, done, ai, icd, gone]) await store.putCase(c.rec, null);

    const dry = await migrateR44(dict, store, { apply: false });
    const by = (c: { rec: CaseRecord }) => dry.find((x) => x.case_id === c.rec.meta.case_id)?.outcome;
    expect([by(eri), by(avj), by(snd), by(avb), by(done), by(ai), by(icd), by(gone)]).toEqual(['fill', 'fill', 'fill', undefined, 'nothing_to_do', 'ai_not_accepted', 'rule_hides', undefined]);
    expect((await store.getCase(eri.rec.meta.case_id))!.rows.DEVICE_IMPLANTS[0].generator_replacement_reasons ?? null).toBeNull(); // dry run wrote nothing

    await migrateR44(dict, store, { apply: true });
    const row = async (c: { rec: CaseRecord }) => (await store.getCase(c.rec.meta.case_id))!.rows.DEVICE_IMPLANTS[0];
    expect((await row(eri)).generator_replacement_reasons).toBe('["END_OF_BATTERY_LIFE"]');
    expect((await row(avj)).pacing_indication_reasons).toBe('["AV_NODE_ABLATION"]');
    expect((await row(snd)).pacing_indication_reasons).toBe('["SICK_SINUS_SYNDROME"]');
    expect((await row(snd)).implant_indication).toBe('SND'); // the old field is never changed
    expect((await row(snd))._updated_by).toBe(R44_ACTOR);
    expect((await row(avb)).pacing_indication_reasons ?? null).toBeNull();
    expect((await row(done)).pacing_indication_reasons).toBe('["CHRONOTROPIC_INCOMPETENCE"]');
    expect((await row(ai)).pacing_indication_reasons ?? null).toBeNull();

    const again = await migrateR44(dict, store, { apply: true });
    expect(again.filter((x) => x.outcome === 'fill')).toHaveLength(0);
  });
});
