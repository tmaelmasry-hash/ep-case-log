// R4-8: data completeness for a whole group (Admin). Synthetic MRNs (999xxxx) only.
import { beforeEach, describe, expect, it } from 'vitest';
import { expectedSlot, readinessOf } from '../../server/domain/cases.ts';
import { COMPLETENESS_SECTIONS, completenessOf, completenessSectionOf } from '../../shared/completeness.ts';
import type { CoreCheck } from '../../shared/readiness.ts';
import { adminOf, as, dict, edit, harness, newCase, rid, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

const check = (over: Partial<CoreCheck>): CoreCheck => ({ key: 'k', entity: 'PATIENTS', field: 'f', label: 'F', procedure_id: null, section: 'patient', group: 'common', state: 'ok', na_allowed: true, ...over });

describe('section grouping (pure)', () => {
  it('maps readiness sections to the six columns', () => {
    expect(completenessSectionOf(dict, check({ section: 'patient' }))).toBe('patient');
    expect(completenessSectionOf(dict, check({ entity: 'ARRHYTHMIA_INDICATIONS', section: 'diagnosis' }))).toBe('history');
    expect(completenessSectionOf(dict, check({ entity: 'CLINICAL_PROFILE_SNAPSHOTS', section: 'risk' }))).toBe('history');
    expect(completenessSectionOf(dict, check({ entity: 'ECHO_STUDIES', section: 'echo' }))).toBe('studies');
    expect(completenessSectionOf(dict, check({ entity: 'FOLLOW_UPS', section: 'followup' }))).toBe('followup');
    expect(completenessSectionOf(dict, check({ entity: 'EP_PROCEDURES', section: 'procedure', procedure_id: 'p' }))).toBe('procedure');
    expect(completenessSectionOf(dict, check({ entity: 'EXT_PROCEDURE_REVIEW', section: 'procedure', procedure_id: 'p' }))).toBe('complications');
  });
  it('counts states; not applicable is left out; core answered = recorded + not available', () => {
    const c = completenessOf(dict, [
      check({ state: 'ok' }),
      check({ state: 'not_available' }),
      check({ state: 'missing' }),
      check({ state: 'ai_pending' }),
      check({ state: 'not_applicable' }),
    ]);
    expect(c.sections.patient).toEqual({ applicable: 4, recorded: 1, not_available: 1, missing: 1, ai_pending: 1 });
    expect(c.sections.studies.applicable).toBe(0);
    expect(c.core).toEqual({ answered: 2, applicable: 4 });
  });
});

describe('GET /api/completeness', () => {
  it('Admin only: a Member gets 403 even typing the URL', async () => {
    const sara = await as(h, 'sara');
    await newCase(sara, '9990801');
    expect((await sara.call('GET', '/api/completeness')).status).toBe(403);
    expect((await sara.call('GET', `/api/completeness?group=${h.groups[0].group_id}`)).status).toBe(403);
  });

  it('one row per case (same MRN = several rows), counts match readiness, no free text', async () => {
    const sara = await as(h, 'sara');
    const admin = await adminOf(h);
    const a = await newCase(sara, '9990802');
    const b = await newCase(sara, '9990802', h.groups[0].group_id, { new_case: true });
    const p = rid('EP_PROCEDURES');
    await edit(sara, a.case_id, {
      creates: [
        { entity: 'EP_PROCEDURES', id: p },
        { entity: 'PROCEDURE_COMPONENTS', id: rid('PROCEDURE_COMPONENTS'), parent_id: p, values: { component_type: 'AVNRT' } },
        { entity: 'EXT_PROCEDURE_REVIEW', id: expectedSlot(dict, 'EXT_PROCEDURE_REVIEW', p), parent_id: p },
      ],
      changes: [{ entity: 'EXT_PROCEDURE_REVIEW', id: expectedSlot(dict, 'EXT_PROCEDURE_REVIEW', p), field: 'complications_reviewed', value: 'NONE_DOCUMENTED' }],
      not_available: [{ entity: 'CLINICAL_PROFILE_SNAPSHOTS', field: 'hypertension', procedure_id: null, reason: 'Not documented in the record' }],
    });
    const r = await admin.call('GET', '/api/completeness?group=all&status=all');
    expect(r.status).toBe(200);
    expect(r.data.sections.map((s: { id: string }) => s.id)).toEqual(COMPLETENESS_SECTIONS.map((s) => s.id));
    expect(r.data.total).toBe(2);
    expect(r.data.rows.map((x: { mrn: string }) => x.mrn)).toEqual(['9990802', '9990802']);
    const ra = r.data.rows.find((x: { case_id: string }) => x.case_id === a.case_id);
    const rb = r.data.rows.find((x: { case_id: string }) => x.case_id === b.case_id);
    expect(ra.no).toBe(a.group_seq);
    expect(ra.procedures).toEqual(['AVNRT']);
    expect(rb.procedures).toEqual([]);
    // Counts come from evaluateReadiness only.
    const ready = readinessOf(dict, (await h.store.getCase(a.case_id))!);
    expect(ra.core).toEqual({ answered: ready.done, applicable: ready.total });
    expect(ra.sections.history.not_available).toBe(1);
    expect(ra.sections.complications).toMatchObject({ applicable: 1, recorded: 1, missing: 0 });
    expect(ra.sections.procedure.applicable).toBeGreaterThan(0);
    expect(rb.sections.procedure.applicable).toBe(0); // "—": nothing required without a procedure
    expect(rb.sections.complications.applicable).toBe(0);
    expect(ra.sections.patient.recorded).toBeGreaterThan(0);
    // No PHI beyond MRN and case No.; no free text (the "not available" reason stays inside the case).
    expect(JSON.stringify(r.data)).not.toContain('Not documented');
    expect(Object.keys(ra).sort()).toEqual(['case_id', 'collection_status', 'core', 'group_id', 'group_name', 'mrn', 'no', 'procedures', 'sections']);
  });

  it('pages of 25, filters by group and by In progress', async () => {
    const sara = await as(h, 'sara');
    const omar = await as(h, 'omar');
    const admin = await adminOf(h);
    for (let i = 0; i < 27; i++) await newCase(sara, `99909${String(i).padStart(2, '0')}`);
    await newCase(omar, '9990990', h.groups[1].group_id);
    const p1 = (await admin.call('GET', '/api/completeness?group=all&status=all&page=1')).data;
    expect(p1).toMatchObject({ total: 28, page: 1, page_size: 25 });
    expect(p1.rows).toHaveLength(25);
    expect(p1.rows.map((x: { no: number }) => x.no).slice(0, 3)).toEqual([1, 2, 3]);
    const p2 = (await admin.call('GET', '/api/completeness?group=all&status=all&page=2')).data;
    expect(p2.rows).toHaveLength(3);
    expect(p2.rows.at(-1).group_id).toBe(h.groups[1].group_id); // groups in their order, then No.
    const g2 = (await admin.call('GET', `/api/completeness?group=${h.groups[1].group_id}&status=all`)).data;
    expect(g2.total).toBe(1);
    expect((await admin.call('GET', '/api/completeness?group=all&status=all&page=all')).data.rows).toHaveLength(28);
    expect((await admin.call('GET', '/api/completeness?group=nope')).status).toBe(404);
    expect((await admin.call('GET', '/api/completeness?page=0')).status).toBe(400);
    // In progress only (the default): a Completed case drops out.
    const c = p1.rows[0].case_id;
    const base = (await h.store.getCase(c, { forEdit: true }))!;
    await h.store.putCase({ ...structuredClone(base), meta: { ...base.meta, collection_status: 'COMPLETED' } }, base);
    expect((await admin.call('GET', '/api/completeness?group=all')).data.total).toBe(27);
    expect((await admin.call('GET', '/api/completeness?group=all&status=all')).data.total).toBe(28);
  });
});
