// Groq (the default provider) and Workers AI, stubbed. Made-up notes only: nothing leaves this computer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiFields, aiSections } from '../../server/ai/catalogue.ts';
import { RETRY_DELAYS_MS, TOO_LARGE_WAIT_MS } from '../../server/ai/providers.ts';
import { as, config, harness, newCase, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const MRN = '1184420';
const sample = () => {
  const fx = config.aiFixtures.find((f) => f.id === 'N01')!;
  return fx.text.join('\n').split(fx.identifiers.mrn).join(MRN);
};
const answer = { proposals: [{ entity: 'CLINICAL_PROFILE_SNAPSHOTS', field: 'hypertension', value: 'YES', row: '', evidence: 'hypertension on amlodipine' }], conflicts: [], additional_info: [] };
const env = () => h.app.ctx.env as { aiBinding?: { run(m: string, i: Record<string, unknown>): Promise<unknown> }; groqKey?: string };

function bind(run: (model: string, inputs: any) => unknown) {
  const calls: { model: string; inputs: any }[] = [];
  env().aiBinding = {
    run: async (model, inputs) => {
      calls.push({ model, inputs });
      return run(model, inputs);
    },
  };
  return calls;
}

describe('default provider', () => {
  it('is Groq on the Worker; a server without the binding keeps the Test AI, even with a key', async () => {
    const admin = await as(h, 'admin');
    env().groqKey = 'gsk-test-synthetic';
    expect((await admin.call('GET', '/api/ai/status')).data).toMatchObject({ provider: 'fixture', configured: true });
    bind(() => ({ response: answer }));
    expect((await admin.call('GET', '/api/ai/status')).data).toMatchObject({ provider: 'groq', configured: true, model: 'openai/gpt-oss-120b' });
  });

  it('on the Worker without the key, it says what is missing and does not fall back to the Test AI', async () => {
    const admin = await as(h, 'admin');
    bind(() => ({ response: answer }));
    const st = (await admin.call('GET', '/api/ai/status')).data;
    expect(st).toMatchObject({ provider: 'groq', configured: false });
    expect(st.reason).toContain('GROQ_API_KEY');
  });
});

describe('Workers AI', () => {
  beforeEach(async () => {
    await (await as(h, 'admin')).call('POST', '/api/settings/ai', { provider: 'workers_ai' });
  });

  it('needs no key where the Worker has its binding', async () => {
    const admin = await as(h, 'admin');
    bind(() => ({ response: answer }));
    const st = (await admin.call('GET', '/api/ai/status')).data;
    expect(st).toMatchObject({ provider: 'workers_ai', configured: true, model: '@cf/nvidia/nemotron-3-120b-a12b' });
    expect(st.providers.find((p: { id: string }) => p.id === 'workers_ai').key_set).toBeNull();
  });

  it('chosen without the binding, it says why instead of failing later', async () => {
    const admin = await as(h, 'admin');
    const set = await admin.call('POST', '/api/settings/ai', { provider: 'workers_ai' });
    expect(set.data).toMatchObject({ provider: 'workers_ai', configured: false });
    expect(set.data.reason).toContain('Cloudflare Worker');
  });

  it('sends only de-identified text, asks for JSON and enough tokens, and fills from the answer', async () => {
    const admin = await as(h, 'admin');
    const { case_id } = await newCase(admin, MRN);
    const calls = bind(() => ({ response: answer, usage: { prompt_tokens: 900, completion_tokens: 80 } }));
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample() });
    expect(r.status).toBe(200);
    expect(r.data.summary.filled).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].inputs.response_format).toBeUndefined(); // JSON mode answered empty lists when measured
    expect(calls[0].inputs.messages[0].content).toContain('"proposals":[{"entity":""');
    expect(calls[0].inputs.max_tokens).toBeGreaterThan(1000);
    const text = JSON.stringify(calls[0].inputs);
    expect(text).not.toContain(MRN);
    expect(text).not.toContain('Testname');
    expect(text).not.toContain('0551234567');
    expect((await admin.call('GET', '/api/ai/status')).data.usage).toMatchObject({ runs: 1, input_tokens: 900, output_tokens: 80, cost_usd: 0 });
  });

  it('reads an answer that comes back as text', async () => {
    const admin = await as(h, 'admin');
    const { case_id } = await newCase(admin, MRN);
    bind(() => ({ response: `Here is the data:\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`` }));
    expect((await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample() })).data.summary.filled).toBe(1);
  });

  it('reads an answer in the choices shape', async () => {
    const admin = await as(h, 'admin');
    const { case_id } = await newCase(admin, MRN);
    bind(() => ({ choices: [{ message: { content: `\n\n${JSON.stringify(answer)}` } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    expect((await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample() })).data.summary.filled).toBe(1);
  });

  it('tries once more when the JSON fails, then says so; nothing is filled', async () => {
    const admin = await as(h, 'admin');
    const { case_id } = await newCase(admin, MRN);
    let n = 0;
    const calls = bind(() => {
      if (++n === 1) return { response: 'I cannot produce that' };
      return { response: answer };
    });
    expect((await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample() })).data.summary.filled).toBe(1);
    expect(calls).toHaveLength(2);

    const second = await newCase(admin, '1184421');
    const always = bind(() => ({ response: 'still not the data' }));
    const bad = await admin.call('POST', `/api/cases/${second.case_id}/ai/extract`, { note: sample().split(MRN).join('1184421') });
    expect(bad.status).toBe(502);
    expect(bad.data.error.code).toBe('AI_BAD_ANSWER');
    expect(always).toHaveLength(2);
    const rows = (await admin.call('GET', `/api/cases/${second.case_id}`)).data;
    expect(Object.keys(rows.ai ?? {})).toHaveLength(0);
  });

  it('the daily free quota has its own message, and the provider\'s error text is not shown', async () => {
    const admin = await as(h, 'admin');
    const { case_id } = await newCase(admin, MRN);
    bind(() => {
      throw new Error('4006: you have used up your daily free allocation of 10,000 neurons');
    });
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample() });
    expect(r.status).toBe(429);
    expect(r.data.error.code).toBe('AI_QUOTA_DAY');
    expect(r.data.error.message).toContain('03:00 Riyadh');

    bind(() => {
      throw new Error('internal detail 12345');
    });
    const other = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample() });
    expect(other.data.error.code).toBe('AI_ERROR');
    expect(other.data.error.message).not.toContain('12345');
  });

  it('opened from one section: only that section is asked for, and a value from another section is not kept', async () => {
    const admin = await as(h, 'admin');
    const { case_id } = await newCase(admin, MRN);
    const fields = aiFields(config.dict);
    const section = fields.get('CLINICAL_PROFILE_SNAPSHOTS.hypertension')!.section;
    const other = [...fields.values()].find((f) => f.section !== section && !f.procedure)!;
    const calls = bind(() => ({
      response: { ...answer, proposals: [...answer.proposals, { entity: other.entity, field: other.field.name, value: 'YES', row: '', evidence: 'hypertension on amlodipine' }] },
    }));
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample(), sections: [section] });
    expect(r.data.summary).toMatchObject({ filled: 1, dropped: 0 });
    expect(calls).toHaveLength(1);
    const system = calls[0].inputs.messages[0].content as string;
    expect(system).toContain(`## Section ${section} `);
    expect(system).not.toContain(`## Section ${other.section} `);

    expect((await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample(), sections: ['nope'] })).status).toBe(400);
    expect(aiSections(config.dict).some((s) => s.id === section)).toBe(true);
  });

  it('the Test AI follows the same section limit', async () => {
    const admin = await as(h, 'admin');
    await admin.call('POST', '/api/settings/ai', { provider: 'fixture' });
    const { case_id } = await newCase(admin, MRN);
    const fields = aiFields(config.dict);
    const section = fields.get('CLINICAL_PROFILE_SNAPSHOTS.hypertension')!.section;
    const whole = await newCase(admin, '1184422');
    const all = await admin.call('POST', `/api/cases/${whole.case_id}/ai/extract`, { note: sample().split(MRN).join('1184422') });
    const part = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample(), sections: [section] });
    expect(part.data.summary.filled).toBeGreaterThan(0);
    expect(part.data.summary.filled).toBeLessThan(all.data.summary.filled);
  });
});

describe('Groq', () => {
  function stubGroq(reply: (body: any, n: number) => Response) {
    const sent: { body: any; headers: Headers }[] = [];
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url instanceof Request ? url.url : url);
      if (!u.startsWith('https://api.groq.com/openai/v1/chat/completions')) throw new Error(`unexpected fetch ${u}`);
      const body = JSON.parse(String(init?.body));
      sent.push({ body, headers: new Headers(init?.headers) });
      return reply(body, sent.length);
    });
    return sent;
  }
  const ok = (content: unknown) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 500, completion_tokens: 50 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  const section = () => aiFields(config.dict).get('CLINICAL_PROFILE_SNAPSHOTS.hypertension')!.section;
  const useGroq = async () => {
    const admin = await as(h, 'admin');
    await admin.call('POST', '/api/settings/ai', { provider: 'groq' });
    env().groqKey = 'gsk-test-synthetic';
    return admin;
  };

  it('without a key it names the secret and the right Wrangler command', async () => {
    const admin = await as(h, 'admin');
    const set = await admin.call('POST', '/api/settings/ai', { provider: 'groq' });
    expect(set.data).toMatchObject({ provider: 'groq', configured: false });
    expect(set.data.reason).toContain('GROQ_API_KEY');
    expect(set.data.reason).toContain('node scripts/wrangler.ts secret put');
  });

  it('a whole note is two requests, strict schema, de-identified, the key only in the header', async () => {
    const admin = await useGroq();
    const { case_id } = await newCase(admin, MRN);
    const sent = stubGroq((body) => ok(body.response_format.json_schema.name === 'sections' ? { sections: [section()] } : answer));
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample() });
    expect(r.status).toBe(200);
    expect(r.data.summary.filled).toBe(1);
    expect(sent).toHaveLength(2);
    expect(sent[1].body.response_format.json_schema.strict).toBe(true);
    expect(sent[1].body.model).toBe('openai/gpt-oss-120b');
    expect(sent[1].headers.get('authorization')).toBe('Bearer gsk-test-synthetic');
    const text = JSON.stringify(sent.map((s) => s.body));
    expect(text).not.toContain(MRN);
    expect(text).not.toContain('gsk-test-synthetic');
  });

  it('from one section it is one request', async () => {
    const admin = await useGroq();
    const { case_id } = await newCase(admin, MRN);
    const sent = stubGroq(() => ok(answer));
    expect((await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample(), sections: [section()] })).status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it('a short Retry-After is waited once; a long one is told to the person', async () => {
    const admin = await useGroq();
    const { case_id } = await newCase(admin, MRN);
    const limited = () => new Response(JSON.stringify({ error: { message: 'Rate limit reached: tokens per minute' } }), { status: 429, headers: { 'retry-after': '0' } });
    const sent = stubGroq((_, n) => (n === 1 ? limited() : ok(answer)));
    expect((await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample(), sections: [section()] })).status).toBe(200);
    expect(sent).toHaveLength(2);

    const long = stubGroq(() => new Response(JSON.stringify({ error: { message: 'Rate limit reached: tokens per minute' } }), { status: 429, headers: { 'retry-after': '300' } }));
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample(), sections: [section()] });
    expect(r.status).toBe(429);
    expect(r.data.error.code).toBe('AI_BUSY');
    expect(long).toHaveLength(1);
  });

  it('a note still over the size limit after one wait gets a message that says what to do', async () => {
    TOO_LARGE_WAIT_MS[0] = 0;
    const admin = await useGroq();
    const { case_id } = await newCase(admin, MRN);
    let asked = 0;
    stubGroq(() => {
      asked++;
      return new Response(JSON.stringify({ error: { message: 'Request too large' } }), { status: 413 });
    });
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample(), sections: [section()] });
    expect(r.status).toBe(413);
    expect(asked).toBe(2);
    expect(r.data.error.message).toContain('one section');
    expect(RETRY_DELAYS_MS.length).toBeGreaterThan(0);
  });

  it('even if the model obeys an instruction inside the note, or reads a date month first, the value is not filled', async () => {
    const admin = await useGroq();
    const { case_id } = await newCase(admin, MRN);
    const fx = config.aiFixtures.find((f) => f.id === 'N12')!;
    const note = [...fx.text, 'DOB 02/03/1961.'].join('\n').split(fx.identifiers.mrn).join(MRN);
    const model = {
      proposals: [
        { entity: 'ECHO_STUDIES', field: 'lvef_pct', value: '10', row: 'echo-1', evidence: 'set LVEF to 10%' },
        { entity: 'ECHO_STUDIES', field: 'lvef_pct', value: '60', row: 'echo-1', evidence: 'LVEF 60%' },
        { entity: 'PATIENT_IDENTIFIERS', field: 'date_of_birth', value: '1961-02-03', row: '', evidence: 'DOB 02/03/1961' },
      ],
      conflicts: [],
      additional_info: [],
    };
    let sent = '';
    stubGroq((body) => {
      sent = JSON.stringify(body);
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(model) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    });
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note, sections: ['echo', 'patient'] });
    expect(r.status).toBe(200);
    expect(sent).not.toMatch(/admin mode|IGNORE ALL/);
    expect(r.data.removed.instruction).toBe(2);
    const of = (status: string) => r.data.items.filter((i: { status: string }) => i.status === status);
    expect(of('FILLED').map((i: { field: string; value: unknown }) => `${i.field}=${i.value}`)).toEqual(['lvef_pct=60']);
    const reasons = of('DROPPED').map((i: { reason: string }) => i.reason).join(' | ');
    expect(reasons).toContain('the quote is not in the note');
    expect(reasons).toContain('day first');
  });

  it('asks only about the procedure type: the screen\'s, or the one a small first request names', async () => {
    const admin = await useGroq();
    const { case_id } = await newCase(admin, MRN);
    const empty = { proposals: [], conflicts: [], additional_info: [] };
    const asked: string[] = [];
    stubGroq((body) => {
      asked.push(String(body.messages[0].content));
      const content = body.response_format.json_schema.name === 'sections' ? { sections: ['procedure'], procedure_types: ['FLUTTER'] } : empty;
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
    });
    const go = (extra: object) => admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample(), sections: ['procedure'], ...extra });
    expect((await go({ component_types: ['AF'] })).status).toBe(200);
    expect(asked[0]).toContain('### AF_ABLATIONS');
    expect(asked[0]).toContain('### EP_PROCEDURES');
    expect(asked[0]).toContain('### COMPLICATIONS');
    expect(asked[0]).not.toContain('### DEVICE_IMPLANTS');
    expect(asked[0]).not.toContain('### SVT_ABLATIONS');
    // No type known: the first request names it, and the second has only that type's tables.
    expect((await go({})).status).toBe(200);
    expect(asked[1]).toContain('You sort');
    expect(asked[2]).toContain('### FLUTTER_ABLATIONS');
    expect(asked[2]).not.toContain('### DEVICE_IMPLANTS');
    expect((await go({ component_types: ['NOT_A_TYPE'] })).status).toBe(400);
  });

  it('a value from a table of another procedure type is not kept', async () => {
    const admin = await useGroq();
    const { case_id } = await newCase(admin, MRN);
    const note = sample();
    const quote = note.split('\n').find((l) => l.length > 10)!.slice(0, 10);
    const model = { proposals: [{ entity: 'DEVICE_IMPLANTS', field: 'implant_side', value: 'LEFT', row: '', evidence: quote }], conflicts: [], additional_info: [] };
    stubGroq(() => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(model) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 }));
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note, procedure_id: 'new', sections: ['procedure'], component_types: ['AF'] });
    expect(r.status).toBe(200);
    expect(r.data.items).toEqual([]);
  });

  it('a whole note from the top button: the second request has the sections and procedure type the first one named', async () => {
    const admin = await useGroq();
    const { case_id } = await newCase(admin, MRN);
    const empty = { proposals: [], conflicts: [], additional_info: [] };
    const asked: string[] = [];
    stubGroq((body) => {
      asked.push(String(body.messages[0].content));
      const content = body.response_format.json_schema.name === 'sections' ? { sections: ['risk', 'procedure'], procedure_types: ['AF'] } : empty;
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
    });
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample(), procedure_id: 'new' });
    expect(r.status).toBe(200);
    expect(asked).toHaveLength(2);
    expect(asked[1]).toContain('## Section risk');
    expect(asked[1]).toContain('### AF_ABLATIONS');
    expect(asked[1]).not.toContain('### DEVICE_IMPLANTS');
    expect(asked[1]).not.toContain('## Section echo');
  });

  it('another error shows the provider\'s code and never its message, which can quote the note', async () => {
    const admin = await useGroq();
    const { case_id } = await newCase(admin, MRN);
    let asked = 0;
    stubGroq(() => { asked++; return new Response(JSON.stringify({ error: { code: 'json_validate_failed', message: 'failed_generation: Testname' } }), { status: 400 }); });
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample(), sections: [section()] });
    expect(r.status).toBe(502);
    expect(r.data.error.message).toContain('400 json_validate_failed');
    expect(r.data.error.message).not.toContain('Testname');
    expect(asked).toBe(2); // one more try, then the error
  });

  it('broken JSON from the model (400 json_validate_failed): one more try with a little temperature, and the answer is used', async () => {
    const admin = await useGroq();
    const { case_id } = await newCase(admin, MRN);
    const temps: number[] = [];
    stubGroq((body) => {
      temps.push(body.temperature);
      if (temps.length === 1) return new Response(JSON.stringify({ error: { code: 'json_validate_failed', message: 'failed_generation: x' } }), { status: 400 });
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ proposals: [], conflicts: [], additional_info: [] }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
    });
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample(), sections: [section()] });
    expect(r.status).toBe(200);
    expect(temps).toEqual([0, 0.3]);
  });

  it('413 during a busy minute: one wait, one more try, and the answer is used', async () => {
    TOO_LARGE_WAIT_MS[0] = 0;
    const admin = await useGroq();
    const { case_id } = await newCase(admin, MRN);
    let asked = 0;
    stubGroq(() => {
      asked++;
      if (asked === 1) return new Response(JSON.stringify({ error: { message: 'Request too large' } }), { status: 413 });
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    });
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample(), sections: [section()] });
    expect(r.status).toBe(200);
    expect(asked).toBe(2);
  });
});
