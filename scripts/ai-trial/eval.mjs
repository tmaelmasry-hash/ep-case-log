// Accuracy trial: the app's own pipeline with a real model against the made-up notes in config/ai_fixtures.json.
// In-memory store, no Sheet, nothing deployed. "Written values" = what the Test AI fills from each note's written answer,
// through the same server checks. These answers do not list every true fact, so "extra" is not the same as wrong.
//
// Workers AI: first, in another terminal, start the local bridge (uses the free quota, resets 03:00 Riyadh):
//   node scripts/wrangler.ts dev --config scripts/ai-trial/wrangler.jsonc --port 8796 --ip 127.0.0.1
// Then, from the project folder:
//   node scripts/ai-trial/eval.mjs N01,N02 "@cf/nvidia/nemotron-3-120b-a12b"     (no list = every note; no model = site.json's)
//   node scripts/ai-trial/eval.mjs N12 groq echo                                  (needs GROQ_API_KEY in .env; last = sections)
// Results: test-results/ai-trial-<groq|model|default>.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const load = (path) => import(pathToFileURL(resolve(path)).href);
const { as, config, harness, newCase } = await load('tests/server/harness.ts');
const { loadDotEnv } = await load('server/dotenv.ts');
loadDotEnv();

const [listArg, modelArg, sectionsArg] = process.argv.slice(2);
const GROQ = modelArg === 'groq';
const only = listArg ? listArg.split(',') : null;
mkdirSync('test-results', { recursive: true });
const OUT = `test-results/ai-trial-${GROQ ? 'groq' : modelArg ? 'model' : 'default'}.json`;

const h = await harness();
const env = h.app.ctx.env;
const admin = await as(h, 'admin');
env.groqKey = process.env.GROQ_API_KEY;
env.aiBinding = {
  run: async (model, inputs) => {
    const res = await fetch('http://127.0.0.1:8796/', { method: 'POST', body: JSON.stringify({ model, inputs }) });
    const j = await res.json();
    if (j?.error) throw new Error(j.error);
    return j;
  },
};

const key = (i) => `${i.entity}|${i.field}|${String(i.value)}`;
const slot = (i) => `${i.entity}|${i.field}`;
const count = (list) => list.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map());

const rows = [];
let n = 0;
for (const fx of config.aiFixtures) {
  if (only && !only.includes(fx.id)) continue;
  const mrn = String(1184500 + 2 * ++n);
  const mrn2 = String(1184501 + 2 * n);
  const text = (m) => fx.text.join('\n').split(fx.identifiers.mrn).join(m);

  await admin.call('POST', '/api/settings/ai', { provider: 'fixture' });
  const a = await newCase(admin, mrn);
  const gold = await admin.call('POST', `/api/cases/${a.case_id}/ai/extract`, { note: text(mrn), procedure_id: 'new' });
  const goldFilled = gold.data.items.filter((i) => i.status === 'FILLED');

  await admin.call('POST', '/api/settings/ai', { provider: GROQ ? 'groq' : 'workers_ai', ...(modelArg && !GROQ ? { model: modelArg } : {}) });
  // Groq's free limit is 8,000 tokens a minute: leave a minute between notes.
  if (GROQ && n > 1) await new Promise((r) => setTimeout(r, 60_000));
  const b = await newCase(admin, mrn2);
  const t0 = Date.now();
  const r = await admin.call('POST', `/api/cases/${b.case_id}/ai/extract`, { note: text(mrn2), procedure_id: 'new', ...(sectionsArg ? { sections: sectionsArg.split(',') } : {}) });
  const ms = Date.now() - t0;
  if (r.status !== 200) {
    rows.push({ id: fx.id, status: r.status, code: r.data?.error?.code, ms });
    console.log(fx.id, 'ERROR', r.status, r.data?.error?.code);
    writeFileSync(OUT, JSON.stringify(rows, null, 1));
    if (r.data?.error?.code === 'AI_QUOTA_DAY') break;
    continue;
  }
  const filled = r.data.items.filter((i) => i.status === 'FILLED');
  const dropped = r.data.items.filter((i) => i.status === 'DROPPED');
  const g = count(goldFilled.map(key));
  const gs = count(goldFilled.map(slot));
  let right = 0;
  const wrongList = [];
  const extraList = [];
  for (const i of filled) {
    const k = key(i);
    if ((g.get(k) ?? 0) > 0) {
      g.set(k, g.get(k) - 1);
      gs.set(slot(i), gs.get(slot(i)) - 1);
      right++;
    } else if ((gs.get(slot(i)) ?? 0) > 0) {
      gs.set(slot(i), gs.get(slot(i)) - 1);
      wrongList.push(`${slot(i)}=${String(i.value).slice(0, 40)}`);
    } else {
      extraList.push(`${slot(i)}=${String(i.value).slice(0, 40)}`);
    }
  }
  const usage = (await admin.call('GET', '/api/ai/status')).data.usage;
  const missed = goldFilled.length - right - wrongList.length;
  rows.push({ id: fx.id, gold: goldFilled.length, right, wrong: wrongList.length, missed, extra: extraList.length, dropped: dropped.length, droppedReasons: dropped.slice(0, 6).map((d) => `${d.entity}.${d.field}: ${d.reason}`.slice(0, 90)), ms, totalInputTokens: usage.input_tokens, totalOutputTokens: usage.output_tokens, wrongList, extraList });
  console.log(`${fx.id} written ${goldFilled.length} right ${right} wrong ${wrongList.length} missed ${missed} extra ${extraList.length} dropped ${dropped.length} ${ms}ms`);
  writeFileSync(OUT, JSON.stringify(rows, null, 1));
}
console.log('DONE', OUT);
process.exit(0);
