// AVNRT questions proposal (30 Oct 2026, docs/AVNRT_QUESTIONS_PROPOSAL.md, rules DR-SVT-01…05, waiting for the owner):
// the SVT ablation section shows accessory-pathway questions only for an accessory-pathway procedure (or an AVRT /
// pre-excited AF mechanism) and AT questions only for an AT procedure (or an AT mechanism). Synthetic data only.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, dict, edit, harness, newCase, rid, type Harness } from './harness.ts';
import { expectedSlot, readinessOf } from '../../server/domain/cases.ts';
import { caseEnv, fieldRules } from '../../shared/rules.ts';

const AP = ['accessory_pathway_manifestation', 'accessory_pathway_location', 'ap_conduction_direction_assessed'];
const AT = ['at_chamber', 'at_site_or_circuit'];
const AVNRT_FITS = ['svt_mechanism', 'ablation_target', 'ablation_energy', 'acute_svt_endpoint'];
const ALL = [...AVNRT_FITS.slice(0, 1), ...AP, ...AT, ...AVNRT_FITS.slice(1)];

/** SVT ablation fields the rules show for one procedure with these components and this mechanism. */
function shown(components: string[], mechanism: string | null = null): string[] {
  const rows: Record<string, Record<string, unknown>[]> = {
    EP_PROCEDURES: [{ _id: 'p1' }],
    PROCEDURE_COMPONENTS: components.map((t, i) => ({ _id: `c${i}`, procedure_id: 'p1', component_type: t })),
    SVT_ABLATIONS: [{ _id: 's1', procedure_id: 'p1', svt_mechanism: mechanism }],
  };
  const env = caseEnv(dict.entities, (e) => (rows[e] ?? []) as never, 'p1');
  return ALL.filter((f) => fieldRules(dict.rules, 'SVT_ABLATIONS', f, env).visible);
}

describe('SVT ablation questions follow the procedure (rules)', () => {
  it('AVNRT alone: only the questions that fit AVNRT', () => {
    expect(shown(['AVNRT'])).toEqual(AVNRT_FITS);
    expect(shown(['AVNRT'], 'TYPICAL_AVNRT')).toEqual(AVNRT_FITS);
    expect(shown(['AVNRT'], 'ATYPICAL_AVNRT')).toEqual(AVNRT_FITS);
  });

  it('AVNRT with an accessory pathway or AT ticked keeps those questions', () => {
    expect(shown(['AVNRT', 'AVRT_WPW'])).toEqual([AVNRT_FITS[0], ...AP, ...AVNRT_FITS.slice(1)]);
    expect(shown(['AVNRT', 'AT_SVT'])).toEqual([AVNRT_FITS[0], ...AT, ...AVNRT_FITS.slice(1)]);
    expect(shown(['AVNRT', 'AVRT_WPW', 'AT_SVT'])).toEqual(ALL);
    expect(shown(['AVRT_WPW'])).toEqual([AVNRT_FITS[0], ...AP, ...AVNRT_FITS.slice(1)]);
    expect(shown(['AT_SVT'])).toEqual([AVNRT_FITS[0], ...AT, ...AVNRT_FITS.slice(1)]);
  });

  it('a mechanism found at the study opens its questions even when only AVNRT was ticked', () => {
    for (const m of ['ORTHODROMIC_AVRT', 'ANTIDROMIC_AVRT', 'PREEXCITED_AF']) expect(shown(['AVNRT'], m), m).toEqual([AVNRT_FITS[0], ...AP, ...AVNRT_FITS.slice(1)]);
    for (const m of ['FOCAL_AT', 'MACROREENTRANT_AT']) expect(shown(['AVNRT'], m), m).toEqual([AVNRT_FITS[0], ...AT, ...AVNRT_FITS.slice(1)]);
    expect(shown(['AVNRT'], 'OTHER')).toEqual(AVNRT_FITS);
  });
});

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

async function svtProcedure(c: Awaited<ReturnType<typeof as>>, id: string, components: string[], mechanism?: string) {
  const pid = rid('EP_PROCEDURES');
  await edit(c, id, {
    creates: [
      { entity: 'EP_PROCEDURES', id: pid },
      ...components.map((t) => ({ entity: 'PROCEDURE_COMPONENTS', id: rid('PROCEDURE_COMPONENTS'), parent_id: pid, values: { component_type: t } })),
      { entity: 'SVT_ABLATIONS', id: expectedSlot(dict, 'SVT_ABLATIONS', pid), parent_id: pid, values: mechanism ? { svt_mechanism: mechanism } : {} },
    ],
  });
  return { pid, svt: expectedSlot(dict, 'SVT_ABLATIONS', pid) };
}
const patch = (c: Awaited<ReturnType<typeof as>>, id: string, changes: unknown[]) => c.call('PATCH', `/api/cases/${id}`, { changes });
const set = (svt: string, field: string, value: unknown) => ({ entity: 'SVT_ABLATIONS', id: svt, field, value });

describe('SVT ablation questions follow the procedure (save check and Ready to complete)', () => {
  it('AVNRT alone: accessory-pathway and AT answers are refused, AVNRT answers are saved', async () => {
    const sara = await as(h, 'sara');
    const id = (await newCase(sara, '9990981')).case_id;
    const { svt } = await svtProcedure(sara, id, ['AVNRT']);
    for (const [f, v] of [['accessory_pathway_manifestation', 'CONCEALED'], ['accessory_pathway_location', 'SEPTAL'], ['ap_conduction_direction_assessed', 'BOTH'], ['at_chamber', 'RA'], ['at_site_or_circuit', 'CRISTA_TERMINALIS']]) {
      const r = await patch(sara, id, [set(svt, f, v)]);
      expect(r.data.results[0], f).toMatchObject({ ok: false, message: expect.stringMatching(/does not apply/) });
    }
    const r = await patch(sara, id, [set(svt, 'svt_mechanism', 'TYPICAL_AVNRT'), set(svt, 'ablation_target', 'SLOW_PATHWAY'), set(svt, 'ablation_energy', 'RF'), set(svt, 'acute_svt_endpoint', 'SLOW_PATHWAY_MODIFICATION')]);
    expect(r.data.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
  });

  it('AVNRT + accessory pathway: the pathway answers are saved, AT answers still refused', async () => {
    const sara = await as(h, 'sara');
    const id = (await newCase(sara, '9990982')).case_id;
    const { svt } = await svtProcedure(sara, id, ['AVNRT', 'AVRT_WPW']);
    const r = await patch(sara, id, [set(svt, 'accessory_pathway_manifestation', 'MANIFEST'), set(svt, 'accessory_pathway_location', 'LEFT_FREE_WALL'), set(svt, 'ap_conduction_direction_assessed', 'BOTH')]);
    expect(r.data.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
    expect((await patch(sara, id, [set(svt, 'at_chamber', 'LA')])).data.results[0].ok).toBe(false);
  });

  it('changing the mechanism away from AVRT asks to remove the pathway answers first (AVNRT ticked alone)', async () => {
    const sara = await as(h, 'sara');
    const id = (await newCase(sara, '9990983')).case_id;
    const { svt } = await svtProcedure(sara, id, ['AVNRT'], 'ORTHODROMIC_AVRT');
    await edit(sara, id, { changes: [set(svt, 'accessory_pathway_location', 'SEPTAL')] });
    let r = await patch(sara, id, [set(svt, 'svt_mechanism', 'TYPICAL_AVNRT')]);
    expect(r.data.results[0]).toMatchObject({ ok: false, message: expect.stringMatching(/first remove .*Accessory pathway location/i) });
    r = await patch(sara, id, [set(svt, 'svt_mechanism', 'TYPICAL_AVNRT'), set(svt, 'accessory_pathway_location', null)]);
    expect(r.data.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
  });

  it('Ready to complete: pathway location is not asked for AVNRT alone, and is asked for AVNRT + WPW with AVRT', async () => {
    const sara = await as(h, 'sara');
    const id = (await newCase(sara, '9990984')).case_id;
    const one = await svtProcedure(sara, id, ['AVNRT'], 'TYPICAL_AVNRT');
    const both = await svtProcedure(sara, id, ['AVNRT', 'AVRT_WPW'], 'ORTHODROMIC_AVRT');
    const r = readinessOf(dict, (await h.store.getCase(id))!);
    const loc = (pid: string) => r.checks.find((c) => c.procedure_id === pid && c.entity === 'SVT_ABLATIONS' && c.field === 'accessory_pathway_location')?.state;
    expect(loc(one.pid)).toBe('not_applicable');
    expect(loc(both.pid)).toBe('missing');
    expect(r.blockers.some((b) => b.procedure_id === one.pid && b.field === 'accessory_pathway_location')).toBe(false);
  });
});
