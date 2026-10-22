// Google Sheet maintenance (reads APPS_SCRIPT_URL and GATEWAY_SECRET from .env; creates GATEWAY_SECRET if missing):
//   npm run sheets -- secret          create GATEWAY_SECRET in .env (first time only; never printed)
//   npm run sheets -- init            store the gateway secret in the Apps Script (first call only)
//   npm run sheets -- setup [--test]  create missing tabs/columns in the registry (or TEST) Sheet
//   npm run sheets -- ping [--test]
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../server/dictionary.ts';
import { loadDotEnv } from '../server/dotenv.ts';
import { sheetsFromEnv } from '../server/store/fromEnv.ts';
import { b64url, randomBytes } from '../server/util.ts';

const [cmd] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (cmd === 'secret') {
  if (!existsSync('.env')) writeFileSync('.env', '# Local settings. Never commit this file.\n');
  if (/^GATEWAY_SECRET=.{32,}/m.test(readFileSync('.env', 'utf8'))) console.log('GATEWAY_SECRET already in .env. Nothing changed.');
  else {
    appendFileSync('.env', `GATEWAY_SECRET=${b64url(randomBytes(36))}\n`);
    console.log('Created GATEWAY_SECRET in .env (not shown).');
  }
  process.exit(0);
}
loadDotEnv();
if (process.argv.includes('--test')) process.env.SHEETS_TARGET = 'test';
const store = sheetsFromEnv(loadConfig());
const t0 = performance.now();
const out = cmd === 'init' ? await store.init() : cmd === 'setup' ? await store.setup() : cmd === 'ping' ? await store.batch([]).then(() => 'reachable') : null;
if (out === null) {
  console.error('Usage: npm run sheets -- secret | init | setup [--test] | ping [--test]');
  process.exit(1);
}
console.log(JSON.stringify(out, null, 1), `(${Math.round(performance.now() - t0)} ms)`);
