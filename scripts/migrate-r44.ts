// R4-4: old implant indication → the new reason fields, exact matches only (server/domain/r44.ts, docs/MERGE_PLAN.md).
//   node scripts/migrate-r44.ts [--test]           dry run: reads only, prints what would be written
//   node scripts/migrate-r44.ts [--test] --apply   writes (only where the new field is empty)
// Reads APPS_SCRIPT_URL / GATEWAY_SECRET from .env. Prints case ids and codes only (no MRN, no name).
import { loadConfig } from '../server/dictionary.ts';
import { migrateR44 } from '../server/domain/r44.ts';
import { loadDotEnv } from '../server/dotenv.ts';
import { sheetsFromEnv } from '../server/store/fromEnv.ts';

loadDotEnv();
const apply = process.argv.includes('--apply');
const test = process.argv.includes('--test');
if (test) process.env.SHEETS_TARGET = 'test';
const config = loadConfig();
const store = sheetsFromEnv(config);
const t0 = performance.now();
const items = await migrateR44(config.dict, store, { apply });
console.log(`${test ? 'TEST' : 'REAL'} Sheet — ${apply ? 'APPLY' : 'DRY RUN (nothing written)'}`);
for (const i of items) console.log(`  ${i.case_id}  ${i.row_id}  old=${i.old}  ${i.outcome}${i.outcome === 'fill' ? `  → ${i.field}` : ''}${i.message ? `  (${i.message})` : ''}`);
const n = (o: string) => items.filter((i) => i.outcome === o).length;
console.log(
  `device rows with a matching old answer: ${items.length} · ${apply ? 'filled' : 'to fill'}: ${n('fill')} · already done: ${n('nothing_to_do')}` +
    ` · AI value not accepted: ${n('ai_not_accepted')} · a show rule hides the field (left empty): ${n('rule_hides')}` +
    ` · changed meanwhile (run again): ${n('stale')}  (${Math.round(performance.now() - t0)} ms)`,
);
