// Starts the local server.  npm start  (reads .env; see .env.example)
// Test/preview mode:  node server/main.ts --e2e  (in-memory store with synthetic accounts; needs E2E_PASSWORD)
import { makeContext } from './context.ts';
import { loadConfig } from './dictionary.ts';
import { loadDotEnv } from './dotenv.ts';
import { startServer } from './node.ts';
import { seedTestUsers } from './seed.ts';
import { storeFromEnv } from './store/fromEnv.ts';
import { MemoryStore } from './store/memory.ts';

loadDotEnv();
const e2e = process.argv.includes('--e2e');
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const secret = process.env.SESSION_SECRET || (e2e ? 'e2e-only-session-secret-0123456789abcdef' : '');
if (!secret) {
  console.error('SESSION_SECRET is not set. Run: npm run setup');
  process.exit(1);
}
const config = loadConfig();
const store = e2e ? new MemoryStore() : storeFromEnv(config);
const ctx = makeContext({ sessionSecret: secret, secureCookies: process.env.SECURE_COOKIES !== '0' }, store, config);

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
