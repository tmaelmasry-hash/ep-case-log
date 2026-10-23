// Copies SESSION_SECRET, APPS_SCRIPT_URL and GATEWAY_SECRET from .env to the Cloudflare Worker's secrets
// (`wrangler secret put`), without printing them.  npm run worker:secrets
import { spawnSync } from 'node:child_process';
import { loadDotEnv } from '../server/dotenv.ts';

loadDotEnv();
for (const name of ['SESSION_SECRET', 'APPS_SCRIPT_URL', 'GATEWAY_SECRET']) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is missing in .env`);
    process.exit(1);
  }
  const r = spawnSync('node', ['scripts/wrangler.ts', 'secret', 'put', name], { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log('Worker secrets set.');
