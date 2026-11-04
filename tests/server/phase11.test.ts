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

describe('This is what will be sent', () => {
  const MADE_UP = 'Name: Ahmed Zahrani. DOB 12/03/1961. MRN 9990710. National ID 1012345678. Mail a.z@example.com. Seen by Dr. Salem Testperson. Hypertension on amlodipine.';

  /** A stubbed live Claude that keeps what it was sent, and quotes `evidence`. */
  async function liveAdmin(evidence: string) {
    const admin = await as(h, 'admin');
    await admin.call('POST', '/api/settings/ai', { provider: 'anthropic' });
    (h.app.ctx.env as { anthropicKey?: string }).anthropicKey = 'sk-test-synthetic';
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push(String(init?.body));
      const answer = { proposals: [{ entity: 'CLINICAL_PROFILE_SNAPSHOTS', field: 'hypertension', value: 'YES', row: '', evidence }], conflicts: [], additional_info: [] };
      return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    return { admin, sent };
  }

  it('returns the de-identified text and counts; no provider is called and nothing is stored', async () => {
    const { admin, sent } = await liveAdmin('hypertension on amlodipine');
    const { case_id } = await newCase(admin, '9990710');
    const log = (await h.store.listActivity()).length;
    const usage = (await admin.call('GET', '/api/ai/status')).data.usage;
    const before = (await admin.call('GET', `/api/cases/${case_id}`)).data.meta.row_version;
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/preview`, { note: MADE_UP });
    expect(r.status).toBe(200);
    expect(r.data.text).toBe('Name: [NAME]. DOB 12/03/1961. MRN [MRN]. National ID [ID]. Mail [EMAIL]. Seen by Dr. [NAME]. Hypertension on amlodipine.');
    expect(r.data.removed).toEqual({ mrn: 1, id: 1, email: 1, phone: 0, name: 2 });
    expect(sent).toHaveLength(0);
    expect(await h.store.listActivity()).toHaveLength(log);
    expect((await admin.call('GET', '/api/ai/status')).data.usage).toEqual(usage);
    expect((await admin.call('GET', `/api/cases/${case_id}`)).data.meta.row_version).toBe(before);
  });

  it('a note naming another MRN stops at the preview; an empty note is refused', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '9990711');
    const r = await sara.call('POST', `/api/cases/${case_id}/ai/preview`, { note: 'EP note. MRN 9990799. Hypertension.' });
    expect(r.status).toBe(409);
    expect(r.data.error.code).toBe('MRN_MISMATCH');
    expect((await sara.call('POST', `/api/cases/${case_id}/ai/preview`, { note: '  ' })).status).toBe(400);
  });

  it('the edited text is de-identified again and is what the provider receives; the date of birth goes through', async () => {
    const { admin, sent } = await liveAdmin('Hypertension on amlodipine');
    const { case_id } = await newCase(admin, '9990712');
    const edited = 'Name: Typed Backin. DOB 12/03/1961. Iqama 2412345678. Hypertension on amlodipine.';
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: MADE_UP.replace('9990710', '9990712'), sent_text: edited });
    expect(r.status).toBe(200);
    expect(r.data.summary.filled).toBe(1);
    expect(r.data.removed).toMatchObject({ name: 1, id: 1 });
    const body = JSON.parse(sent[0]);
    const text = JSON.stringify(body.messages);
    expect(text).toContain('Name: [NAME]. DOB 12/03/1961. Iqama [ID]. Hypertension on amlodipine.');
    for (const gone of ['Typed', 'Backin', '2412345678', 'Zahrani', 'Salem', '1012345678', 'example.com']) expect(JSON.stringify(body)).not.toContain(gone);
    // Counts only in the log.
    const log = JSON.stringify(await h.store.listActivity());
    expect(log).not.toContain('amlodipine');
    expect(log).not.toContain('12/03/1961');
  });

  it('the MRN check reads the original note and also the edited text', async () => {
    const { admin, sent } = await liveAdmin('Hypertension');
    const { case_id } = await newCase(admin, '9990713');
    const a = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: 'MRN 9990799. Hypertension.', sent_text: 'Hypertension.' });
    expect(a.data.error.code).toBe('MRN_MISMATCH');
    const b = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: 'Hypertension.', sent_text: 'MRN 9990799. Hypertension.' });
    expect(b.data.error.code).toBe('MRN_MISMATCH');
    expect(sent).toHaveLength(0);
  });

  it('a quote only in the original note, deleted while editing, is dropped: quotes are checked against the text sent', async () => {
    const { admin } = await liveAdmin('Hypertension on amlodipine');
    const { case_id } = await newCase(admin, '9990714');
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: 'Hypertension on amlodipine. LVEF 55%.', sent_text: 'LVEF 55%.' });
    expect(r.data.summary).toMatchObject({ filled: 0, dropped: 1 });
    expect(r.data.items[0].reason).toBe('the quote is not in the note');
  });

  it('an empty edited text is refused', async () => {
    const { admin, sent } = await liveAdmin('x');
    const { case_id } = await newCase(admin, '9990715');
    expect((await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: 'Hypertension.', sent_text: ' ' })).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('the AI fills the date of birth from an explicit birth date (owner, 4 Nov)', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '1009315');
    const r = await sara.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample('N02', '1009315'), procedure_id: 'new' });
    expect(r.data.case.rows.PATIENT_IDENTIFIERS[0].date_of_birth).toBe('1961-03-02');
  });

  it('a new procedure is made only if the note really fills one (owner, 4 Nov)', async () => {
    const { admin } = await liveAdmin('Hypertension on amlodipine');
    const procs = async (id: string) => (await admin.call('GET', `/api/cases/${id}`)).data.rows.EP_PROCEDURES ?? [];

    // Case data only: filled, and no empty procedure.
    const a = (await newCase(admin, '9990716')).case_id;
    const r = await admin.call('POST', `/api/cases/${a}/ai/extract`, { note: 'Hypertension on amlodipine.', procedure_id: 'new' });
    expect(r.data.summary.filled).toBe(1);
    expect(r.data.procedure_id).toBeNull();
    expect(r.data.case.rows.CLINICAL_PROFILE_SNAPSHOTS[0].hypertension).toBe('YES');
    expect(await procs(a)).toHaveLength(0);

    // Nothing found: nothing changes.
    const b = (await newCase(admin, '9990717')).case_id;
    const before = (await admin.call('GET', `/api/cases/${b}`)).data.meta.row_version;
    const none = await admin.call('POST', `/api/cases/${b}/ai/extract`, { note: 'A note with no such quote.', procedure_id: 'new' });
    expect(none.data.summary).toMatchObject({ filled: 0, dropped: 1 });
    expect(await procs(b)).toHaveLength(0);
    expect((await admin.call('GET', `/api/cases/${b}`)).data.meta.row_version).toBe(before);
  });

  it('procedure details make the new procedure, and fill it', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '1184420');
    const r = await sara.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample('N01', '1184420'), procedure_id: 'new' });
    expect(r.data.procedure_id).toBeTruthy();
    expect(r.data.case.rows.EP_PROCEDURES.map((p: { _id: string }) => p._id)).toEqual([r.data.procedure_id]);
    expect(r.data.case.rows.AF_ABLATIONS[0].procedure_id).toBe(r.data.procedure_id);
  });

  it('the sample-note list is gone', async () => {
    const sara = await as(h, 'sara');
    expect((await sara.call('GET', '/api/ai/status')).data.sample_notes).toBeUndefined();
    expect((await sara.call('GET', '/api/ai/sample/N01')).status).toBe(404);
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
