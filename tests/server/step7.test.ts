// Screen review step 7 (owner, 29 Oct): Hajj season vs rest on the Dashboard, cases by month, the statistics file.
// Synthetic MRNs (9990xxx) only.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, edit, harness, newCase, rid, type Harness } from './harness.ts';
import { readXlsx } from './readXlsx.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness(); // today = 2026-10-22
});

async function afCase(admin: Awaited<ReturnType<typeof as>>, mrn: string, date: string) {
  const { case_id } = await newCase(admin, mrn, h.groups[0].group_id, { episode_start_date: date });
  const pid = rid('EP_PROCEDURES');
  await edit(admin, case_id, {
    creates: [
      { entity: 'EP_PROCEDURES', id: pid, values: { procedure_start_datetime: `${date}T09:00` } },
      { entity: 'PROCEDURE_COMPONENTS', id: rid('PROCEDURE_COMPONENTS'), parent_id: pid, values: { component_type: 'AF' } },
    ],
  });
  const d = (await admin.call('GET', `/api/cases/${case_id}`)).data;
  await edit(admin, case_id, { changes: [{ entity: 'PATIENTS', id: d.meta.patient_id, field: 'sex_at_birth', value: 'FEMALE' }] });
  return case_id;
}

describe('Dashboard: Hajj season and cases by month', () => {
  it('splits procedures by the Hajj season (1 Dhu al-Qa\'dah to 15 Muharram) and counts cases per month', async () => {
    const admin = await as(h, 'admin');
    await afCase(admin, '9990701', '2026-05-20'); // 3 Dhu al-Hijjah 1447: in season
    await afCase(admin, '9990702', '2026-03-01'); // 12 Ramadan 1447: rest of year
    const d = (await admin.call('GET', '/api/dashboard?basis=ALL')).data;
    expect(d.clinical.hajj_split.find((x: { id: string }) => x.id === 'AF_ABLATION')).toMatchObject({ hajj: 1, rest: 1 });
    expect(d.progress.by_month).toEqual([
      { month: '2026-03', completed: 0, in_progress: 1 },
      { month: '2026-05', completed: 0, in_progress: 1 },
    ]);
  });
});

describe('statistics file', () => {
  it('Admin only; one row per procedure in the period, values in words, no identifiers beyond the MRN', async () => {
    const admin = await as(h, 'admin');
    const sara = await as(h, 'sara');
    await afCase(admin, '9990711', '2026-05-20');
    await afCase(admin, '9990712', '2026-03-01');
    expect((await sara.call('POST', '/api/exports/stats', {})).status).toBe(403);
    expect((await admin.call('POST', '/api/exports/stats', { from: '20-01-2026' })).status).toBe(400);
    const r = await admin.call('POST', '/api/exports/stats', { from: '2026-04-01', to: '2026-10-22', basis: 'ALL', per: 'PROCEDURE' });
    expect(r.status).toBe(200);
    expect(r.data.file_name).toBe('KAMC_EP_Registry_statistics_2026-04-01_to_2026-10-22.xlsx');
    const x = readXlsx(r.data.base64);
    expect(Object.keys(x)).toEqual(['Procedures', 'Columns', 'About']);
    const [head, ...rows] = x.Procedures;
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row[head.indexOf('MRN')]).toBe('9990711');
    expect(row[head.indexOf('Hajj season')]).toBe('Yes');
    expect(row[head.indexOf('Sex')]).toBe('Female');
    expect(String(row[head.indexOf('Procedure')])).toContain('AF');
    expect(head.some((c) => /identifier|full name|date of birth/i.test(String(c)))).toBe(false);
    expect(x.Columns.length).toBeGreaterThan(50);

    const all = readXlsx((await admin.call('POST', '/api/exports/stats', { basis: 'ALL', per: 'CASE' })).data.base64);
    expect(Object.keys(all)[0]).toBe('Cases');
    expect(all.Cases.length).toBe(3);
  });
});
