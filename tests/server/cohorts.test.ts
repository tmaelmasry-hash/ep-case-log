// Custom cohorts (owner R2-12): Admin makes rule and tag cohorts; cases join a rule on their own; only the Admin tags;
// Members see cohorts with their own groups' cases only. Synthetic MRNs (9990xxx) only.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, edit, harness, newCase, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

const hajj = { name: 'Hajj patients', kind: 'rule', color: 'cat-pilgrim', match: 'ALL', conditions: [{ field: 'EP_EPISODES.pilgrim_status', op: 'in', values: ['HAJJ'] }] };

async function setPilgrim(c: Awaited<ReturnType<typeof as>>, id: string, value: string) {
  const d = (await c.call('GET', `/api/cases/${id}`)).data;
  await edit(c, id, { changes: [{ entity: 'EP_EPISODES', id: d.rows.EP_EPISODES[0]._id, field: 'pilgrim_status', value }] });
}
const inList = async (c: Awaited<ReturnType<typeof as>>, id: string) => (await c.call('GET', '/api/cases')).data.cases.find((x: { case_id: string }) => x.case_id === id)?.cohorts ?? null;

describe('cohorts', () => {
  it('a rule cohort holds the matching cases on its own, now and later; preview counts them', async () => {
    const admin = await as(h, 'admin');
    const a = (await newCase(admin, '9990901')).case_id;
    const b = (await newCase(admin, '9990902')).case_id;
    await setPilgrim(admin, a, 'HAJJ');
    const r = await admin.call('POST', '/api/cohorts', hajj);
    expect(r.status).toBe(200);
    expect((await admin.call('POST', '/api/cohorts/preview', hajj)).data.count).toBe(1);
    expect(await inList(admin, a)).toEqual([r.data.id]);
    expect(await inList(admin, b)).toEqual([]);
    await setPilgrim(admin, b, 'HAJJ'); // joins without anyone adding it
    expect(await inList(admin, b)).toEqual([r.data.id]);
    expect((await admin.call('GET', `/api/cases/${b}`)).data.summary.cohorts).toEqual([r.data.id]);
  });

  it('only the Admin makes cohorts and tags cases; a Member sees them with own-group cases', async () => {
    const admin = await as(h, 'admin');
    const sara = await as(h, 'sara');
    expect((await sara.call('POST', '/api/cohorts', hajj)).status).toBe(403);
    const t = (await admin.call('POST', '/api/cohorts', { name: 'PFA study 2026', kind: 'tag', color: 'cat-flutter' })).data;
    const mine = (await newCase(admin, '9990911', h.groups[0].group_id)).case_id;
    const other = (await newCase(admin, '9990912', h.groups[1].group_id)).case_id;
    expect((await sara.call('POST', `/api/cohorts/${t.id}/cases/${mine}`, { on: true })).status).toBe(403);
    expect((await admin.call('POST', `/api/cohorts/${t.id}/cases/${mine}`, { on: true })).status).toBe(200);
    expect((await admin.call('POST', `/api/cohorts/${t.id}/cases/${other}`, { on: true })).status).toBe(200);
    expect((await sara.call('GET', '/api/cohorts')).data.cohorts.map((c: { name: string }) => c.name)).toEqual(['PFA study 2026']);
    expect(await inList(sara, mine)).toEqual([t.id]);
    expect(await inList(sara, other)).toBe(null); // not in her groups at all
    await admin.call('POST', `/api/cohorts/${t.id}/cases/${mine}`, { on: false });
    expect(await inList(admin, mine)).toEqual([]);
    const log = JSON.stringify((await admin.call('GET', '/api/admin/activity')).data.items);
    expect(log).toContain('added to cohort PFA study 2026');
  });

  it('the Admin renames, recolors and hides a built-in cohort, and resets it; Members cannot', async () => {
    const admin = await as(h, 'admin');
    const sara = await as(h, 'sara');
    expect((await sara.call('POST', '/api/cohorts/builtin/PILGRIMS', { label: 'Pilgrims KAMC' })).status).toBe(403);
    let r = await admin.call('POST', '/api/cohorts/builtin/PILGRIMS', { label: 'Pilgrims KAMC', color: 'cat-af', hidden: true });
    expect(r.data.overrides.PILGRIMS).toEqual({ label: 'Pilgrims KAMC', color: 'cat-af', hidden: true });
    expect((await sara.call('GET', '/api/cohorts')).data.overrides.PILGRIMS.hidden).toBe(true);
    r = await admin.call('POST', '/api/cohorts/builtin/PILGRIMS', { reset: true });
    expect(r.data.overrides.PILGRIMS).toBeUndefined();
    expect((await admin.call('POST', '/api/cohorts/builtin/no-such-id', { hidden: true })).status).toBe(404);
  });

  it('refuses identifiers, wrong comparisons, duplicate names; delete hides the cohort', async () => {
    const admin = await as(h, 'admin');
    const bad = (conditions: unknown[]) => admin.call('POST', '/api/cohorts', { ...hajj, name: 'X', conditions });
    expect((await bad([{ field: 'PATIENT_IDENTIFIERS.date_of_birth', op: 'before', values: ['1990-01-01'] }])).status).toBe(400);
    expect((await bad([{ field: 'EP_EPISODES.pilgrim_status', op: 'lt', values: [3] }])).status).toBe(400);
    expect((await bad([{ field: 'EP_EPISODES.pilgrim_status', op: 'in', values: ['MARS'] }])).status).toBe(400);
    const c = (await admin.call('POST', '/api/cohorts', hajj)).data;
    expect((await admin.call('POST', '/api/cohorts', hajj)).status).toBe(409);
    expect((await admin.call('POST', `/api/cohorts/${c.id}/cases/x`, { on: true })).status).toBe(400); // rule cohort: no tags
    expect((await admin.call('POST', `/api/cohorts/${c.id}/delete`)).status).toBe(200);
    expect((await admin.call('GET', '/api/cohorts')).data.cohorts).toEqual([]);
  });
});
