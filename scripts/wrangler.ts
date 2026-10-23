// Runs Wrangler with this project's own Cloudflare sign-in (Tarek.kamc), kept apart from the EP Workspace sign-in
// (kamc.ep2026) that other sessions on this PC use. The sign-in lives in ~/.ep-registry-wrangler, outside git.
//   node scripts/wrangler.ts whoami | login | deploy | rollback <id> | secret put NAME
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const env = { ...process.env, XDG_CONFIG_HOME: join(homedir(), '.ep-registry-wrangler') };
const r = spawnSync('npx', ['wrangler', ...process.argv.slice(2)], { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
