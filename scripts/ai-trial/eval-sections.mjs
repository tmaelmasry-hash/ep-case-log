// Accuracy trial for Groq's free plan, where a whole note is over the limit: one request per section, as from a section's AI icon.
// Each note is asked only about the sections its written answer touches, and compared with that section's written values.
// So "extra" counts less here than in eval.mjs, which asks about every section at once. In-memory store, made-up notes only.
//   node scripts/ai-trial/eval-sections.mjs N02,N12                  (no list = every note; needs GROQ_API_KEY in .env)
// Results: test-results/ai-trial-groq-sections.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const load = (path) => import(pathToFileURL(resolve(path)).href);
const { as, config, harness, newCase } = await load('tests/server/harness.ts');
const { loadDotEnv } = await load('server/dotenv.ts');
const { aiFields } = await load('server/ai/catalogue.ts');
loadDotEnv();

const only = process.argv[2] ? process.argv[2].split(',') : null;
const OUT = 'test-results/ai-trial-groq-sections.json';
mkdirSync('test-results', { recursive: true });

const h = await harness();
h.app.ctx.env.groqKey = process.env.GROQ_API_KEY;
const admin = await as(h, 'admin');
const fields = aiFields(config.dict);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sectionOf = (i) => fields.get(`${i.entity}.${i.field}`)?.section ?? '?';
const key = (i) => `${i.entity}|${i.field}|${String(i.value)}`;
const slot = (i) => `${i.entity}|${i.field}`;
const short = (i) => `${slot(i)}=${String(i.value).slice(0, 40)}`;
const count = (list) => list.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map());
const used = async () => {
  const u = (await admin.call('GET', '/api/ai/status')).data.usage;
  return u.input_tokens + u.output_tokens;
};

let mrnNo = 1184500;
const nextMrn = () => String(++mrnNo);
const rows = [];
let stop = false;

for (const fx of config.aiFixtures) {
  if (stop) break;
  if (only && !only.includes(fx.id)) continue;
  const text = (m) => fx.text.join('\n').split(fx.identifiers.mrn).join(m);

  await admin.call('POST', '/api/settings/ai', { provider: 'fixture' });
  const goldMrn = nextMrn();
  const goldCase = await newCase(admin, goldMrn);
  const gold = await admin.call('POST', `/api/cases/${goldCase.case_id}/ai/extract`, { note: text(goldMrn), procedure_id: 'new' });
  const goldFilled = gold.data.items.filter((i) => i.status === 'FILLED');
  const sections = [...new Set(goldFilled.map(sectionOf))];

  await admin.call('POST', '/api/settings/ai', { provider: 'groq' });
  for (const section of sections) {
    const goldHere = goldFilled.filter((i) => sectionOf(i) === section);
    const mrn = nextMrn();
    const c = await newCase(admin, mrn);
    const before = await used();
    const t0 = Date.now();
    let r = await admin.call('POST', `/api/cases/${c.case_id}/ai/extract`, { note: text(mrn), procedure_id: 'new', sections: [section] });
    if (r.status === 429 && r.data?.error?.code === 'AI_BUSY') {
      await sleep(60_000);
      r = await admin.call('POST', `/api/cases/${c.case_id}/ai/extract`, { note: text(mrn), procedure_id: 'new', sections: [section] });
    }
    const ms = Date.now() - t0;
    if (r.status !== 200) {
      const code = r.data?.error?.code;
      rows.push({ id: fx.id, section, gold: goldHere.length, status: r.status, code, ms });
      console.log(fx.id, section, 'ERROR', r.status, code);
      writeFileSync(OUT, JSON.stringify(rows, null, 1));
      if (code === 'AI_QUOTA_DAY') { stop = true; break; }
      await sleep(60_000);
      continue;
    }
    const filled = r.data.items.filter((i) => i.status === 'FILLED');
    const g = count(goldHere.map(key));
    const gs = count(goldHere.map(slot));
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
        wrongList.push(short(i));
      } else {
        extraList.push(short(i));
      }
    }
    const tokens = (await used()) - before;
    const dropped = r.data.items.filter((i) => i.status === 'DROPPED').length;
    rows.push({ id: fx.id, section, gold: goldHere.length, right, wrong: wrongList.length, missed: goldHere.length - right - wrongList.length, extra: extraList.length, dropped, ms, tokens, wrongList, extraList, must_not: fx.must_not, all: filled.map(short) });
    console.log(`${fx.id} ${section}: written ${goldHere.length} right ${right} wrong ${wrongList.length} extra ${extraList.length} dropped ${dropped} ${ms}ms ${tokens} tokens`);
    writeFileSync(OUT, JSON.stringify(rows, null, 1));
    // Stay under 8,000 tokens a minute.
    await sleep(Math.max(3000, (tokens / 8000) * 60_000 + 2000));
  }
}
const ok = rows.filter((x) => x.right !== undefined);
const sum = (k) => ok.reduce((a, x) => a + x[k], 0);
console.log(`TOTAL requests ${rows.length} errors ${rows.length - ok.length} written ${sum('gold')} right ${sum('right')} wrong ${sum('wrong')} missed ${sum('missed')} extra ${sum('extra')} tokens ${sum('tokens')}`);
console.log('DONE', OUT);
process.exit(0);
