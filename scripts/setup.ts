// One-time setup:  npm run setup [-- --username <name>] [-- --reset-admin-password]
// Creates .env with a random SESSION_SECRET (if missing), Groups 1–3, and the first Admin with a one-time password,
// in the store named by .env STORE (file by default; sheets = the Google Sheet, after `npm run sheets -- setup`).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generatePassword, normalizeUsername, newUser, setPasswordByAdmin, usernameProblem } from '../server/auth/auth.ts';
import { makeContext } from '../server/context.ts';
import { loadConfig } from '../server/dictionary.ts';
import { ensureDefaultGroups } from '../server/seed.ts';
import { storeFromEnv } from '../server/store/fromEnv.ts';
import { loadDotEnv } from '../server/dotenv.ts';
import { b64url, newId, randomBytes } from '../server/util.ts';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

if (!existsSync('.env')) writeFileSync('.env', '# Local settings. Never commit this file.\n');
let env = readFileSync('.env', 'utf8');
if (!/^SESSION_SECRET=.{32,}/m.test(env)) {
  appendFileSync('.env', `SESSION_SECRET=${b64url(randomBytes(48))}\n`);
  console.log('Created SESSION_SECRET in .env');
}
env = readFileSync('.env', 'utf8');
const secret = /^SESSION_SECRET=(.*)$/m.exec(env)![1].trim();
loadDotEnv();

const config = loadConfig();
const store = storeFromEnv(config);
console.log(`Store: ${store.kind}`);
const ctx = makeContext({ sessionSecret: secret, secureCookies: true }, store, config);
await ensureDefaultGroups(store);
const groups = (await store.listGroups()).map((g) => g.group_id);
const admins = (await store.listUsers()).filter((u) => u.role === 'ADMIN');
const username = normalizeUsername(arg('--username') ?? 'admin');

if (process.argv.includes('--reset-admin-password')) {
  const u = admins.find((a) => a.username === username);
  if (!u) throw new Error(`No Admin named "${username}".`);
  const pw = generatePassword();
  await setPasswordByAdmin(ctx, u.user_id, pw, true);
  console.log(`New one-time password for ${username}: ${pw}\n(It is shown only now. You will choose your own at first sign-in.)`);
} else if (admins.length) {
  console.log(`An Admin already exists (${admins.map((a) => a.username).join(', ')}). Nothing changed.`);
} else {
  const problem = usernameProblem(username);
  if (problem) throw new Error(problem);
  const id = newId('usr');
  await store.createUser(newUser({ user_id: id, username, display_name: username, role: 'ADMIN', groups }));
  const pw = generatePassword();
  await setPasswordByAdmin(ctx, id, pw, true);
  console.log(`First Admin created.\n  Username: ${username}\n  One-time password: ${pw}\n(It is shown only now. You will choose your own at first sign-in.)`);
}
