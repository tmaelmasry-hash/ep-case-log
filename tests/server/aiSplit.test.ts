// A whole note too large for Groq's free per-minute limit (8,000 tokens) is sent in parts (7 Nov). Groq is stubbed;
// made-up notes only, nothing leaves this computer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiFields, catalogueText } from '../../server/ai/catalogue.ts';
import { PACE_CLOCK, estimateTokens, resetPacers, fixtureExtract, mergeRaw, pacer, splitSections } from '../../server/ai/extract.ts';
import { TOO_LARGE_WAIT_MS, type LlmProvider } from '../../server/ai/providers.ts';
import { redact } from '../../server/ai/redact.ts';
import { as, config, harness, newCase, type Harness } from './harness.ts';

let h: Harness;
const clock = { ...PACE_CLOCK };
let now = 0;
let slept: number[] = [];
beforeEach(async () => {
  h = await harness();
  now = 1_000_000;
  slept = [];
  PACE_CLOCK.now = () => now;
  PACE_CLOCK.sleep = async (ms: number) => {
    slept.push(ms);
    now += ms;
  };
  TOO_LARGE_WAIT_MS[0] = 0;
  resetPacers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(PACE_CLOCK, clock);
  TOO_LARGE_WAIT_MS[0] = 60_000;
});

const env = () => h.app.ctx.env as { aiBinding?: unknown; groqKey?: string };
const BUDGET = 8000 * 0.85;
const note = (id: string, mrn: string) => {
  const fx = config.aiFixtures.find((f) => f.id === id)!;
  return { text: fx.text.join('\n').split(fx.identifiers.mrn).join(mrn), fx };
};
/** What the Test AI fills from the note, as a provider's answer: every part gets all of it, as a model that answers too much would. */
const fullAnswer = (text: string, mrn: string) => fixtureExtract(config, redact(text, { mrn }).text)!.raw;
const sectionsOf = (raw: ReturnType<typeof fullAnswer>) => [...new Set(raw.proposals.map((p) => aiFields(config.dict).get(`${p.entity}.${p.field}`)?.section).filter((s): s is string => !!s))];
const reply = (content: unknown, tokens = [500, 50]) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: tokens[0], completion_tokens: tokens[1] } }), { status: 200 });
const tooLarge = () => new Response(JSON.stringify({ error: { message: 'Request too large' } }), { status: 413 });

function stubGroq(answer: (body: any, n: number) => Response) {
  const sent: any[] = [];
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push(body);
    return answer(body, sent.length);
  });
  return sent;
}
const isSegment = (body: any) => body.response_format.json_schema.name === 'sections';
const fieldList = (body: any) => String(body.messages[0].content);
const sectionsAsked = (body: any) => [...fieldList(body).matchAll(/## Section (\w+)/g)].map((m) => m[1]);

async function groqAdmin() {
  const admin = await as(h, 'admin');
  await admin.call('POST', '/api/settings/ai', { provider: 'groq' });
  env().groqKey = 'gsk-test-synthetic';
  return admin;
}
async function testAiFilled(admin: Awaited<ReturnType<typeof as>>, text: string, mrn: string) {
  await admin.call('POST', '/api/settings/ai', { provider: 'fixture' });
  const c = await newCase(admin, mrn);
  const r = await admin.call('POST', `/api/cases/${c.case_id}/ai/extract`, { note: text, procedure_id: 'new' });
  await admin.call('POST', '/api/settings/ai', { provider: 'groq' });
  return r.data.items.filter((i: any) => i.status === 'FILLED').map((i: any) => `${i.entity}.${i.field}=${JSON.stringify(i.value)}`).sort();
}

describe('whole note in parts', () => {
  it('a device note over the limit: procedure alone, the rest in groups that fit, and the merged answer is what one request would give', async () => {
    const admin = await groqAdmin();
    const { text } = note('N07', '1184430');
    const gold = await testAiFilled(admin, text.split('1184430').join('1184432'), '1184432');
    const raw = fullAnswer(text, '1184430');
    const sections = [...new Set([...sectionsOf(raw), 'patient', 'risk', 'ecg', 'devices', 'meds', 'procedure'])];
    const sent = stubGroq((body) => (isSegment(body) ? reply({ sections, procedure_types: ['DEVICE_IMPLANT'] }) : reply(raw)));
    const { case_id } = await newCase(admin, '1184430');
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: text, procedure_id: 'new' });
    expect(r.status).toBe(200);
    const parts = sent.filter((b) => !isSegment(b)).map(sectionsAsked);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toEqual(['procedure']);
    expect(parts.slice(1).flat().sort()).toEqual(sections.filter((s) => s !== 'procedure').sort());
    for (const b of sent.filter((x) => !isSegment(x)).slice(1)) expect(String(b.messages[0].content).length + String(b.messages[1].content).length + 1500).toBeLessThan(BUDGET * 2.7);
    // Every part answered everything, yet each value is there once and passed the usual checks.
    const filled = r.data.items.filter((i: any) => i.status === 'FILLED').map((i: any) => `${i.entity}.${i.field}=${JSON.stringify(i.value)}`).sort();
    expect(filled).toEqual(gold);
    expect(r.data.items.filter((i: any) => i.status === 'CONFLICT')).toEqual([]);
  });

  it('a small note stays two requests', async () => {
    const admin = await groqAdmin();
    const { text } = note('N16', '1184434');
    const sent = stubGroq((body) => (isSegment(body) ? reply({ sections: ['risk', 'ecg'], procedure_types: [] }) : reply({ proposals: [], conflicts: [], additional_info: [] })));
    const { case_id } = await newCase(admin, '1184434');
    expect((await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: text })).status).toBe(200);
    expect(sent).toHaveLength(2);
    expect(slept).toEqual([]);
  });

  it('paces the parts within the per-minute limit', async () => {
    const admin = await groqAdmin();
    const { text } = note('N07', '1184436');
    const sections = ['patient', 'diagnosis', 'risk', 'ecg', 'devices', 'meds', 'procedure'];
    // Each part uses 6,000 tokens: the next waits until the minute has room again.
    stubGroq((body) => (isSegment(body) ? reply({ sections, procedure_types: ['DEVICE_IMPLANT'] }, [800, 200]) : reply({ proposals: [], conflicts: [], additional_info: [] }, [4000, 2000])));
    const { case_id } = await newCase(admin, '1184436');
    expect((await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: text })).status).toBe(200);
    expect(slept.length).toBeGreaterThan(0);
    expect(slept.every((ms) => ms > 0 && ms <= 61_000)).toBe(true);
  });

  it('413 on a request estimated to fit: sent again in smaller parts at once, without the minute\'s wait', async () => {
    const admin = await groqAdmin();
    const { text } = note('N16', '1184438');
    TOO_LARGE_WAIT_MS[0] = 3_600_000; // a wait would hang the test
    const sent = stubGroq((body) => (isSegment(body) ? reply({ sections: ['risk', 'ecg', 'labs'], procedure_types: [] }) : sectionsAsked(body).length > 1 ? tooLarge() : reply({ proposals: [], conflicts: [], additional_info: [] })));
    const { case_id } = await newCase(admin, '1184438');
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: text });
    expect(r.status).toBe(200);
    const parts = sent.filter((b) => !isSegment(b)).map(sectionsAsked);
    expect(parts.filter((p) => p.length === 1).flat().sort()).toEqual(['ecg', 'labs', 'risk']);
  });

  it('429 on a part although it was paced: one wait until the minute has passed, then the part is sent again', async () => {
    const admin = await groqAdmin();
    const { text } = note('N16', '1184442');
    let busy = 0;
    const sent = stubGroq((body) => {
      if (isSegment(body)) return reply({ sections: ['risk', 'procedure'], procedure_types: ['AF'] });
      if (sectionsAsked(body).length > 1) return tooLarge();
      if (sectionsAsked(body)[0] === 'risk' && busy++ < 2) return new Response(JSON.stringify({ error: { message: 'Rate limit reached for tokens per minute (TPM)' } }), { status: 429, headers: { 'retry-after': '0' } });
      return reply({ proposals: [], conflicts: [], additional_info: [] });
    });
    const { case_id } = await newCase(admin, '1184442');
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: text });
    expect(r.status).toBe(200);
    expect(sent.filter((b) => !isSegment(b)).map((b) => sectionsAsked(b).join('+'))).toEqual(['risk+procedure', 'procedure', 'risk', 'risk', 'risk']);
    expect(slept.some((ms) => ms >= 59_000)).toBe(true);
  });

  it('one section that is still too large: one wait and one more try, then the 413 is shown', async () => {
    const admin = await groqAdmin();
    const { text } = note('N16', '1184440');
    const sent = stubGroq((body) => (isSegment(body) ? reply({ sections: ['procedure'], procedure_types: [] }) : tooLarge()));
    const { case_id } = await newCase(admin, '1184440');
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: text });
    expect(r.status).toBe(413);
    expect(r.data.error.code).toBe('AI_TOO_LONG');
    expect(sent.filter((b) => !isSegment(b))).toHaveLength(2);
  });
});

describe('parts, pacing and merging', () => {
  const groq = { id: 'groq', model: 'm', label: 'Groq', passes: 2, limit: { tokensPerMinute: 8000, charsPerToken: 2.7 }, json: async () => ({ json: {}, inputTokens: 0, outputTokens: 0 }) } as LlmProvider;

  it('splitSections: procedure alone, every other section once, each group within the share of the limit', () => {
    const all = ['patient', 'diagnosis', 'risk', 'labs', 'ecg', 'holter', 'devices', 'echo', 'tee', 'cag', 'meds', 'others', 'procedure'];
    const parts = splitSections(config, groq, 'x'.repeat(400), all, ['DEVICE_IMPLANT']);
    expect(parts[0]).toEqual(['procedure']);
    expect(parts.flat().sort()).toEqual([...all].sort());
    for (const g of parts.slice(1)) if (g.length > 1) expect(estimateTokens(groq, catalogueText(config.dict, g, ['DEVICE_IMPLANT']), 'x'.repeat(400))).toBeLessThanOrEqual(BUDGET);
  });

  it('pacer: room at the start, then waits until what the last minute spent leaves room', async () => {
    const pace = pacer(8000, 'a');
    await pace.wait(6000);
    expect(slept).toEqual([]);
    pace.spend(2000);
    now += 20_000;
    pace.spend(5000);
    await pace.wait(2000); // 7,000 in the minute: the first 2,000 leave 40 s later
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeGreaterThanOrEqual(40_000);
    expect(slept[0]).toBeLessThan(41_000);
    await pace.wait(1000);
    expect(slept).toHaveLength(1);
    // Another key has its own minute.
    await pacer(8000, 'b').wait(8000);
    expect(slept).toHaveLength(1);
  });

  it('mergeRaw keeps a fact that fits no field once', () => {
    const a = { proposals: [], conflicts: [], additional_info: [{ text: 'Driving advice given.', evidence: 'driving' }] };
    const b = { proposals: [], conflicts: [], additional_info: [{ text: 'driving advice given.', evidence: 'driving' }, { text: 'Other.', evidence: '' }] };
    expect(mergeRaw(a, b).additional_info.map((x) => x.text)).toEqual(['Driving advice given.', 'Other.']);
  });
});

