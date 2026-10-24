// M-1 dynamic-form rules (EP Workspace config/forms/rules.json, one evaluator for screen and server), adapted to
// several procedures per case: each procedure's fields follow that procedure's own answers. Synthetic data only.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, dict, edit, harness, newCase, rid, type Harness } from './harness.ts';
import { expectedSlot } from '../../server/domain/cases.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

async function addProcedure(c: Awaited<ReturnType<typeof as>>, id: string, components: string[]) {
  const pid = rid('EP_PROCEDURES');
  await edit(c, id, { creates: [{ entity: 'EP_PROCEDURES', id: pid }, ...components.map((t) => ({ entity: 'PROCEDURE_COMPONENTS', id: rid('PROCEDURE_COMPONENTS'), parent_id: pid, values: { component_type: t } }))] });
  return pid;
}
const patch = (c: Awaited<ReturnType<typeof as>>, id: string, changes: unknown[]) => c.call('PATCH', `/api/cases/${id}`, { changes });

describe('dynamic-form rules (M-1)', () => {
  it('a field shows and saves only when its trigger answer says it applies', async () => {
    const sara = await as(h, 'sara');
    const id = (await newCase(sara, '9990951')).case_id;
    const p = await addProcedure(sara, id, ['AVNRT']);
    const time = { entity: 'EP_PROCEDURES', id: p, field: 'mapping_system', value: 'CARTO' };
    let r = await patch(sara, id, [time]);
    expect(r.data.results[0]).toMatchObject({ ok: false, message: expect.stringMatching(/does not apply/) });
    r = await patch(sara, id, [{ entity: 'EP_PROCEDURES', id: p, field: 'electroanatomic_mapping_used', value: true }, time]);
    expect(r.data.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
  });

  it('a change that makes an answer not apply is refused, unless the same save clears that answer', async () => {
    const sara = await as(h, 'sara');
    const id = (await newCase(sara, '9990952')).case_id;
    const p = await addProcedure(sara, id, ['AVNRT']);
    await edit(sara, id, { changes: [{ entity: 'EP_PROCEDURES', id: p, field: 'electroanatomic_mapping_used', value: true }, { entity: 'EP_PROCEDURES', id: p, field: 'mapping_system', value: 'CARTO' }] });
    const off = { entity: 'EP_PROCEDURES', id: p, field: 'electroanatomic_mapping_used', value: false };
    let r = await patch(sara, id, [off]);
    expect(r.data.results[0]).toMatchObject({ ok: false, message: expect.stringMatching(/first remove .*Mapping system/i) });
    r = await patch(sara, id, [off, { entity: 'EP_PROCEDURES', id: p, field: 'mapping_system', value: null }]);
    expect(r.data.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
  });

  it('each procedure follows its own answers and components', async () => {
    const sara = await as(h, 'sara');
    const id = (await newCase(sara, '9990953')).case_id;
    const af = await addProcedure(sara, id, ['AF']);
    const svt = await addProcedure(sara, id, ['AVNRT']);
    await edit(sara, id, { changes: [{ entity: 'EP_PROCEDURES', id: af, field: 'electroanatomic_mapping_used', value: true }] });
    // Mapping used on the AF procedure does not open the mapping system on the SVT procedure.
    expect((await patch(sara, id, [{ entity: 'EP_PROCEDURES', id: svt, field: 'mapping_system', value: 'CARTO' }])).data.results[0].ok).toBe(false);
    expect((await patch(sara, id, [{ entity: 'EP_PROCEDURES', id: af, field: 'mapping_system', value: 'CARTO' }])).data.results[0].ok).toBe(true);
    // "Not applicable" for first / redo is not offered on an AF procedure (spec I1), but is on the SVT one.
    expect((await patch(sara, id, [{ entity: 'EP_PROCEDURES', id: af, field: 'first_or_redo', value: 'NOT_APPLICABLE' }])).data.results[0].ok).toBe(false);
    expect((await patch(sara, id, [{ entity: 'EP_PROCEDURES', id: svt, field: 'first_or_redo', value: 'NOT_APPLICABLE' }])).data.results[0].ok).toBe(true);
  });

  it('readiness does not count a core field the rules hide; the old combined stroke item stays hidden while empty', async () => {
    const sara = await as(h, 'sara');
    const id = (await newCase(sara, '9990954')).case_id;
    const d = (await sara.call('GET', `/api/cases/${id}`)).data;
    expect(d.summary.core.total).toBeGreaterThan(0);
    const before = d.summary.core.total;
    const slot = expectedSlot(dict, 'CLINICAL_PROFILE_SNAPSHOTS', id);
    await edit(sara, id, { creates: [{ entity: 'CLINICAL_PROFILE_SNAPSHOTS', id: slot, values: { prior_tia: 'NO' } }] });
    const r = await patch(sara, id, [{ entity: 'CLINICAL_PROFILE_SNAPSHOTS', id: slot, field: 'prior_stroke_tia_systemic_embolism', value: 'YES' }]);
    expect(r.data.results[0]).toMatchObject({ ok: false, message: expect.stringMatching(/does not apply|cannot be edited/) }); // M-4a (hidden since the 24 Oct field review): the old item takes no new answers
    expect((await sara.call('GET', `/api/cases/${id}`)).data.summary.core.total).toBe(before);
  });
});
