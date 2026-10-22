// Phase 6: bulk add MRNs (EP Workspace). Synthetic MRNs (9990xxx) only.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, harness, newCase, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

const paste = ['9990301', '٩٩٩٠٣٠٢', '9990301', '123', '9990303', '', '9990304\t9990305'].join('\n');

describe('bulk add MRNs', () => {
  it('Admin only; preview writes nothing and classifies every line', async () => {
    const sara = await as(h, 'sara');
    expect((await sara.call('POST', '/api/imports/mrns/preview', { group_id: h.groups[0].group_id, text: paste })).status).toBe(403);
    const admin = await as(h, 'admin');
    await newCase(admin, '9990303');
    const r = await admin.call('POST', '/api/imports/mrns/preview', { group_id: h.groups[0].group_id, text: paste });
    expect(r.status).toBe(200);
    expect(r.data.rows.map((x: { status: string }) => x.status)).toEqual(['READY', 'READY', 'REPEATED', 'INVALID', 'ALREADY_HERE', 'READY', 'READY']);
    expect(r.data.rows[1]).toMatchObject({ value: '9990302', message: 'Arabic digits normalised' });
    expect(r.data.summary).toMatchObject({ total: 7, ready: 4, repeated: 1, invalid: 1, already_here: 1, blank: 1 });
    expect(r.data.numbers).toEqual({ from: 2, to: 5 });
    expect((await admin.call('GET', '/api/cases')).data.cases).toHaveLength(1);
  });

  it('commit adds ready rows in order with consecutive numbers; a retried click adds nothing; a changed list is refused', async () => {
    const admin = await as(h, 'admin');
    const g = h.groups[0].group_id;
    const pv = (await admin.call('POST', '/api/imports/mrns/preview', { group_id: g, text: paste, episode_start_date: '2026-04-01' })).data;
    const body = { group_id: g, text: paste, episode_start_date: '2026-04-01', preview_token: pv.preview_token, idempotency_key: 'bulk-key-0001' };
    expect((await admin.call('POST', '/api/imports/mrns/commit', { ...body, text: `${paste}\n9990399` })).status).toBe(409);
    const r = await admin.call('POST', '/api/imports/mrns/commit', body);
    expect(r.status).toBe(200);
    expect(r.data.added).toBe(5); // 9990303 is new here now (no case before this commit)
    expect(r.data.rows.filter((x: { outcome: string }) => x.outcome === 'ADDED').map((x: { group_seq: number }) => x.group_seq)).toEqual([1, 2, 3, 4, 5]);
    const again = await admin.call('POST', '/api/imports/mrns/commit', body);
    expect(again.data).toMatchObject({ replayed: true, added: 5 });
    const cases = (await admin.call('GET', '/api/cases')).data.cases;
    expect(cases).toHaveLength(5);
    expect(cases.every((c: { episode_start_date: string }) => c.episode_start_date === '2026-04-01')).toBe(true);
  });

  it('an MRN already here is skipped unless ticked; ticked rows add a new case with history copied', async () => {
    const admin = await as(h, 'admin');
    const g = h.groups[0].group_id;
    await newCase(admin, '9990310');
    const text = '9990310\n9990311';
    const pv = (await admin.call('POST', '/api/imports/mrns/preview', { group_id: g, text })).data;
    const r1 = await admin.call('POST', '/api/imports/mrns/commit', { group_id: g, text, preview_token: pv.preview_token, idempotency_key: 'bulk-key-0002' });
    expect(r1.data.rows.map((x: { outcome: string }) => x.outcome)).toEqual(['ALREADY_HERE', 'ADDED']);
    const r2 = await admin.call('POST', '/api/imports/mrns/commit', { group_id: g, text, preview_token: pv.preview_token, idempotency_key: 'bulk-key-0003', add_existing: [1] });
    expect(r2.data.rows[0]).toMatchObject({ outcome: 'ADDED', group_seq: 3 });
    const cases = (await admin.call('GET', '/api/cases')).data.cases.filter((c: { mrn: string }) => c.mrn === '9990310');
    expect(cases).toHaveLength(2);
    expect(cases.every((c: { episode_start_date: string | null }) => c.episode_start_date === null || c.episode_start_date === '2026-03-12')).toBe(true);
    const log = (await admin.call('GET', '/api/admin/activity')).data.items;
    expect(log.some((x: { kind: string; details: string }) => x.kind === 'BULK ADD' && x.details.includes('1 of 2 MRNs added'))).toBe(true);
  });
});
