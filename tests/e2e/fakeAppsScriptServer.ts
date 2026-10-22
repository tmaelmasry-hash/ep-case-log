// Local stand-in for the Apps Script web app (tests only): the real apps-script/Code.js on a fake spreadsheet,
// served over HTTP, seeded with synthetic accounts. Lets the Cloudflare Worker run end to end without Google.
//   node tests/e2e/fakeAppsScriptServer.ts <port> <gateway secret> <password | - for an empty sheet, not yet initialised>
import { createServer } from 'node:http';
import { loadConfig } from '../../server/dictionary.ts';
import { seedTestUsers } from '../../server/seed.ts';
import { SheetsStore } from '../../server/store/sheets.ts';
import { FakeAppsScript } from '../server/fakeGoogle.ts';

const [port, secret, password] = process.argv.slice(2);
const google = new FakeAppsScript(secret);
const empty = password === '-';
if (!empty) await google.call('init');
const store = new SheetsStore(loadConfig(), google);
if (!empty) await store.setup();
if (!empty) await seedTestUsers(store, password, [
  { username: 'admin', name: 'Test Admin', role: 'ADMIN', groupIndex: [0, 1, 2] },
  { username: 'sara', name: 'Sara (test)', role: 'MEMBER', groupIndex: [0] },
  { username: 'newbie', name: 'New User (test)', role: 'MEMBER', mustChange: true, groupIndex: [1] },
]);

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let out: unknown;
    try {
      out = google.post(body || '{}');
    } catch (e) {
      out = { ok: false, error: (e as Error).message };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
}).listen(Number(port), '127.0.0.1', () => console.log(`fake Apps Script on ${port}`));
