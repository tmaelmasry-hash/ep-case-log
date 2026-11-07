// Gemini, OpenAI and Claude, stubbed: ready for the day the owner adds a key (7 Nov). Made-up notes only: nothing leaves this computer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiFields } from '../../server/ai/catalogue.ts';
import { as, config, harness, newCase, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const MRN = '1184430';
const sample = () => {
  const fx = config.aiFixtures.find((f) => f.id === 'N01')!;
  return fx.text.join('\n').split(fx.identifiers.mrn).join(MRN);
};
const answer = { proposals: [{ entity: 'CLINICAL_PROFILE_SNAPSHOTS', field: 'hypertension', value: 'YES', row: '', evidence: 'hypertension on amlodipine' }], conflicts: [], additional_info: [] };
const section = () => aiFields(config.dict).get('CLINICAL_PROFILE_SNAPSHOTS.hypertension')!.section;
type Keys = { geminiKey?: string; openaiKey?: string; anthropicKey?: string };
const env = () => h.app.ctx.env as Keys;

function stub(prefix: string, reply: (body: any) => unknown) {
  const sent: { url: string; body: any; headers: Headers }[] = [];
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    if (!u.startsWith(prefix)) throw new Error(`unexpected fetch ${u}`);
    const raw = init?.body ?? (url instanceof Request ? await url.text() : '');
    const body = JSON.parse(String(raw));
    sent.push({ url: u, body, headers: new Headers(init?.headers ?? (url instanceof Request ? url.headers : undefined)) });
    return new Response(JSON.stringify(reply(body)), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return sent;
}

async function use(provider: 'gemini' | 'openai' | 'anthropic', key: keyof Keys) {
  const admin = await as(h, 'admin');
  const off = await admin.call('POST', '/api/settings/ai', { provider });
  expect(off.data).toMatchObject({ provider, configured: false }); // no key yet: says so
  env()[key] = `${provider}-test-synthetic`;
  return admin;
}

function checkSent(sent: { body: any; headers: Headers; url: string }[], key: string) {
  expect(sent.length).toBe(1);
  const all = JSON.stringify(sent[0].body);
  expect(all).not.toContain(MRN); // de-identified before sending
  expect(all).not.toContain(key); // the key only in a header
  expect(sent[0].url).not.toContain(key);
}

describe('providers ready for a key', () => {
  it('Gemini: one request, schema without additionalProperties, the answer is used', async () => {
    const admin = await use('gemini', 'geminiKey');
    const sent = stub('https://generativelanguage.googleapis.com/v1beta/models/', () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(answer) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } }));
    const { case_id } = await newCase(admin, MRN);
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample(), sections: [section()] });
    expect(r.status).toBe(200);
    expect(r.data.provider).toContain('Gemini');
    expect(r.data.summary.filled).toBe(1);
    checkSent(sent, 'gemini-test-synthetic');
    expect(sent[0].url).toContain(encodeURIComponent(config.site.ai.gemini.model));
    expect(sent[0].headers.get('x-goog-api-key')).toBe('gemini-test-synthetic');
    expect(JSON.stringify(sent[0].body.generationConfig.responseSchema)).not.toContain('additionalProperties');
  });

  it('OpenAI: one request with a strict schema, the answer is used', async () => {
    const admin = await use('openai', 'openaiKey');
    const sent = stub('https://api.openai.com/v1/responses', () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }], usage: { input_tokens: 100, output_tokens: 20 } }));
    const { case_id } = await newCase(admin, MRN);
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample(), sections: [section()] });
    expect(r.status).toBe(200);
    expect(r.data.summary.filled).toBe(1);
    checkSent(sent, 'openai-test-synthetic');
    expect(sent[0].body.model).toBe(config.site.ai.openai.model);
    expect(sent[0].body.text.format.strict).toBe(true);
    expect(sent[0].headers.get('authorization')).toBe('Bearer openai-test-synthetic');
  });

  it('Claude: one request, the answer is used', async () => {
    const admin = await use('anthropic', 'anthropicKey');
    const sent = stub('https://api.anthropic.com/v1/messages', (body) => ({ id: 'msg_test', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20 } }));
    const { case_id } = await newCase(admin, MRN);
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample(), sections: [section()] });
    expect(r.status).toBe(200);
    expect(r.data.summary.filled).toBe(1);
    checkSent(sent, 'anthropic-test-synthetic');
    expect(sent[0].body.model).toBe(config.site.ai.anthropic.model);
  });
});
