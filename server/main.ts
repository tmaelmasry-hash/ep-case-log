// Starts the local server.  npm start  (reads .env; see .env.example)
// Test/preview mode:  node server/main.ts --e2e  (in-memory store with synthetic accounts; needs E2E_PASSWORD)
import { existsSync, readFileSync } from 'node:fs';
import { makeContext } from './context.ts';
import { loadConfig } from './dictionary.ts';
import { startServer } from './node.ts';
import { seedTestUsers } from './seed.ts';
import { FileStore } from './store/file.ts';
import { MemoryStore } from './store/memory.ts';

function loadDotEnv(file = '.env') {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

loadDotEnv();
const e2e = process.argv.includes('--e2e');
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const secret = process.env.SESSION_SECRET || (e2e ? 'e2e-only-session-secret-0123456789abcdef' : '');
if (!secret) {
  console.error('SESSION_SECRET is not set. Run: npm run setup');
  process.exit(1);
}
const store = e2e || process.env.STORE === 'memory' ? new MemoryStore() : new FileStore(process.env.DATA_DIR || 'data');
const ctx = makeContext({ sessionSecret: secret, secureCookies: process.env.SECURE_COOKIES !== '0' }, store, loadConfig());

if (e2e) {
  const pw = process.env.E2E_PASSWORD;
  if (!pw) throw new Error('E2E_PASSWORD is required with --e2e');
  await seedTestUsers(store, pw, [
    { username: 'admin', name: 'Test Admin', role: 'ADMIN', groupIndex: [0, 1, 2] },
    { username: 'sara', name: 'Sara (test)', role: 'MEMBER', groupIndex: [0] },
    { username: 'newbie', name: 'New User (test)', role: 'MEMBER', mustChange: true, groupIndex: [1] },
  ]);
}

startServer(ctx, { port, host, distDir: process.env.DIST_DIR || 'dist' });
console.log(`EP Case Log on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}  (store: ${store.kind}${e2e ? ', synthetic test accounts' : ''})`);
