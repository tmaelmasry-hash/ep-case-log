// Screen review step 6 (owner, 29 Oct): move a case to another group, Bulk add's planned type, AI show / hide.
// Synthetic MRNs (9990xxx) only.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, harness, newCase, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

describe('move a case to another group', () => {
  it('Admin only; takes the next number there and keeps the old one in History', async () => {
    const admin = await as(h, 'admin');
    const sara = await as(h, 'sara');
    const [g1, g2] = h.groups;
    const { case_id } = await newCase(admin, '9990601', g1.group_id);
    await newCase(admin, '9990602', g2.group_id); // g2 No. 1 is taken
    expect((await sara.call('POST', `/api/cases/${case_id}/move`, { group_id: g2.group_id })).status).toBe(403);
    expect((await admin.call('POST', `/api/cases/${case_id}/move`, { group_id: 'grp_nope' })).status).toBe(400);
    const r = await admin.call('POST', `/api/cases/${case_id}/move`, { group_id: g2.group_id });
    expect(r.status).toBe(200);
    expect(r.data.case.meta).toMatchObject({ group_id: g2.group_id, group_seq: 2 });
    const hist = (await admin.call('GET', `/api/cases/${case_id}/history`)).data.items;
    expect(hist.some((x: { text?: string }) => x.text === `Moved from ${g1.name} No. 1 to ${g2.name} No. 2`)).toBe(true);
  });
});

describe('Bulk add with one procedure type', () => {
  it('marks the new cases as planned (a dictionary code only); the mark goes once a procedure exists', async () => {
    const admin = await as(h, 'admin');
    const g = h.groups[0].group_id;
    const text = '9990611\n9990612';
    const bad = await admin.call('POST', '/api/imports/mrns/preview', { group_id: g, text, planned_type: 'NOT_A_CODE' });
    expect(bad.status).toBe(400);
    const pv = (await admin.call('POST', '/api/imports/mrns/preview', { group_id: g, text, planned_type: 'AF' })).data;
    const r = await admin.call('POST', '/api/imports/mrns/commit', { group_id: g, text, planned_type: 'AF', preview_token: pv.preview_token, idempotency_key: 'bulk-step6-01' });
    expect(r.data.added).toBe(2);
    const list = (await admin.call('GET', '/api/cases')).data.cases as { mrn: string; planned_type?: string | null }[];
    expect(list.filter((c) => c.mrn.startsWith('999061')).map((c) => c.planned_type)).toEqual(['AF', 'AF']);
  });
});

describe('AI Assistant show / hide', () => {
  it('only the Admin switches it; everyone is told through /api/auth/me', async () => {
    const admin = await as(h, 'admin');
    const sara = await as(h, 'sara');
    expect((await sara.call('GET', '/api/auth/me')).data.features.ai).toBe(true);
    expect((await sara.call('POST', '/api/settings/ui', { ai_visible: false })).status).toBe(403);
    expect((await admin.call('POST', '/api/settings/ui', { ai_visible: 'no' })).status).toBe(400);
    expect((await admin.call('POST', '/api/settings/ui', { ai_visible: false })).status).toBe(200);
    expect((await sara.call('GET', '/api/auth/me')).data.features.ai).toBe(false);
  });
});
