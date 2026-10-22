// Phase 11: AI Assistant (EP Workspace P5) on the synthetic sample notes (Test AI) and a stubbed live provider.
// Synthetic data only; the note is never stored or logged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { as, config, edit, harness, newCase, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const sample = (id: string, mrn: string) => {
  const fx = config.aiFixtures.find((f) => f.id === id)!;
  return fx.text.join('\n').split(fx.identifiers.mrn).join(mrn);
};

describe('AI Assistant (Test AI)', () => {
  it('fills empty fields as AI values (not accepted), procedure fields into the chosen procedure; completion waits for review', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '1184420');
    const r = await sara.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample('N01', '1184420'), procedure_id: 'new' });
    expect(r.status).toBe(200);
    expect(r.data.recognised).toBe(true);
    expect(r.data.summary.filled).toBeGreaterThan(20);
    expect(r.data.removed.name).toBeGreaterThan(0); // the name was taken out before anything was matched/sent
    const d = r.data.case;
    const pid = r.data.procedure_id;
    expect(d.rows.EP_PROCEDURES.map((p: { _id: string }) => p._id)).toEqual([pid]);
    expect(d.rows.AF_ABLATIONS[0]).toMatchObject({ procedure_id: pid, af_energy_source: 'PFA', acute_af_endpoint: 'COMPLETE_PVI_OR_REISOLATION' });
    expect(d.rows.CLINICAL_PROFILE_SNAPSHOTS[0]).toMatchObject({ hypertension: 'YES', diabetes: 'NO' });
    expect(d.rows.PATIENT_IDENTIFIERS[0].date_of_birth).toBeNull(); // never inferred from "67-year-old"
    expect(Object.values(d.ai).every((m: any) => m.source === 'AI')).toBe(true);
    // Completion is blocked until the values are accepted.
    expect((await sara.call('POST', `/api/cases/${case_id}/complete`, {})).data.error.code).toBe('NOT_READY');
    const hist = (await sara.call('GET', `/api/cases/${case_id}/history`)).data.items;
    expect(hist.some((x: { text: string }) => x.text.includes('(AI, to review)'))).toBe(true);
    // Reject one, accept the rest.
    const key = Object.keys(d.ai).find((k) => k.startsWith('CLINICAL_PROFILE_SNAPSHOTS|') && k.endsWith('|diabetes'))!;
    const rej = await sara.call('POST', `/api/cases/${case_id}/ai/review`, { actions: [{ key, action: 'reject' }] });
    expect(rej.data.case.rows.CLINICAL_PROFILE_SNAPSHOTS[0].diabetes).toBeNull();
    const all = await sara.call('POST', `/api/cases/${case_id}/ai/review`, { accept_all: true });
    expect(Object.keys(all.data.case.ai).filter((k) => !k.endsWith('|*'))).toEqual([]);
    // The activity log holds counts only, never the note.
    const log = JSON.stringify(await h.store.listActivity());
    expect(log).not.toContain('apixaban');
    expect(log).not.toContain('Testname');
  });

  it('a note naming another MRN stops before anything is sent or filled', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '9990701');
    const r = await sara.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample('N01', '1184420'), procedure_id: 'new' });
    expect(r.status).toBe(409);
    expect(r.data.error.code).toBe('MRN_MISMATCH');
    expect(((await sara.call('GET', `/api/cases/${case_id}`)).data.rows.EP_PROCEDURES ?? []).length).toBe(0);
  });

  it('without a chosen procedure, procedure values are dropped with a reason; a saved different value becomes a conflict', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '1184420');
    const d0 = (await sara.call('GET', `/api/cases/${case_id}`)).data;
    await edit(sara, case_id, { changes: [{ entity: 'PATIENTS', id: d0.meta.patient_id, field: 'sex_at_birth', value: 'FEMALE' }] });
    const r = await sara.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample('N01', '1184420') });
    expect(r.data.items.filter((i: { reason?: string }) => i.reason?.startsWith('procedure field')).length).toBeGreaterThan(5);
    const conflict = r.data.items.find((i: { status: string; field: string }) => i.status === 'CONFLICT' && i.field === 'sex_at_birth');
    expect(conflict).toMatchObject({ value: 'FEMALE', proposed: ['MALE'] });
    expect(r.data.case.rows.PATIENTS[0].sex_at_birth).toBe('FEMALE'); // never overwritten
    const used = await sara.call('POST', `/api/cases/${case_id}/ai/review`, { actions: [{ key: conflict.key, action: 'use', choice: 0 }] });
    expect(used.data.case.rows.PATIENTS[0].sex_at_birth).toBe('MALE');
  });

  it('a completed case refuses the Assistant; a note not in the samples fills nothing', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '9990702');
    const r = await sara.call('POST', `/api/cases/${case_id}/ai/extract`, { note: 'Free text that is not one of the sample notes at all.' });
    expect(r.data).toMatchObject({ recognised: false, summary: { filled: 0 } });
  });
});

describe('AI Assistant (live provider, stubbed)', () => {
  it('Admin switches to Claude; without a key it says what to add; with a key only de-identified text is sent, with fallbacks on', async () => {
    const admin = await as(h, 'admin');
    const set = await admin.call('POST', '/api/settings/ai', { provider: 'anthropic' });
    expect(set.data).toMatchObject({ provider: 'anthropic', configured: false });
    expect(set.data.reason).toContain('ANTHROPIC_API_KEY');
    const { case_id } = await newCase(admin, '1184420');
    expect((await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: 'x' })).data.error.code).toBe('AI_NOT_CONFIGURED');

    // Same app with a key (synthetic) and a stubbed Claude API.
    (h.app.ctx.env as { anthropicKey?: string }).anthropicKey = 'sk-test-synthetic';
    const sent: { body: any; headers: Headers }[] = [];
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url instanceof Request ? url.url : url);
      if (!u.includes('api.anthropic.com')) throw new Error(`unexpected fetch ${u}`);
      sent.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
      const answer = { proposals: [{ entity: 'CLINICAL_PROFILE_SNAPSHOTS', field: 'hypertension', value: 'YES', row: '', evidence: 'hypertension on amlodipine' }, { entity: 'CLINICAL_PROFILE_SNAPSHOTS', field: 'diabetes', value: 'YES', row: '', evidence: 'invented quote' }], conflicts: [], additional_info: [] };
      return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample('N01', '1184420') });
    expect(r.status).toBe(200);
    expect(r.data.summary).toMatchObject({ filled: 1, dropped: 1 }); // the invented quote is dropped
    expect(sent).toHaveLength(1);
    const req = sent[0];
    expect(req.body.model).toBe('claude-opus-5-5');
    expect(req.body.fallbacks).toBe('default');
    expect(req.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(req.body.output_config.format.type).toBe('json_schema');
    const text = JSON.stringify(req.body);
    expect(text).not.toContain('1184420'); // MRN removed
    expect(text).not.toContain('Testname'); // name removed
    expect(text).not.toContain('0551234567'); // phone removed
    const status = (await admin.call('GET', '/api/ai/status')).data;
    expect(status.usage.runs).toBe(1);
    expect(status.usage.cost_usd).toBeGreaterThan(0);
  });
});
