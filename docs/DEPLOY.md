# Deploy EP Case Log: Google Sheet + Apps Script + Cloudflare Worker (phase 4)

The app runs as one **Cloudflare Worker** (pages and `/api`). The data lives in a **Google Sheet** that the Worker reads
and writes through a small **Apps Script web app** (`apps-script/Code.js`), protected by a shared secret.
Secrets never go into git or into a chat: they live in `.env` on the computer, in the Apps Script's script
properties, and in the Worker's secrets.

Accounts (decision D9): the owner's Google account and Cloudflare account (Workers & Pages).
Before you start, the test items in both accounts are cleaned up (`docs/ACCOUNTS_CLEANUP_HANDOFF.md`).
The live EP Workspace registry is never touched (decision D5).

## A. Google: the registry Sheet and its Apps Script (owner, in the browser, about 10 minutes)
1. In Google Drive, create a new blank Google Sheet named **EP Case Log — Registry**.
2. In that Sheet: **Extensions → Apps Script**. Delete what is in `Code.gs` and paste all of `apps-script/Code.js`. Save.
3. **Project Settings** (gear) → tick **Show "appsscript.json" manifest file**. Open `appsscript.json` and replace it with
   `apps-script/appsscript.json`. Save.
4. Choose the function **setupSheets** at the top and press **Run**. Google asks for permission (Sheets, Drive,
   triggers, external requests): allow it. This links the Sheet, creates a separate **TEST** Sheet (synthetic data only)
   and the daily backup at 10:00 Riyadh time (folder **EP Case Log Backups**, newest 30 kept).
5. **Deploy → New deployment →** type **Web app**. Execute as: **Me**. Who has access: **Anyone**. Deploy.
   Copy the **Web app URL** (it ends in `/exec`). Keep it private; it is useless without the secret, but do not post it.
   Later code updates: **Deploy → Manage deployments → Edit → New version** (same URL).

## B. On the computer: connect the Sheet, create the first Admin
In the project folder (`git clone https://github.com/tmaelmasry-hash/ep-case-log`), with Node 22.18 or newer:
```
npm install
```
Add to `.env` (create the file if it does not exist):
```
STORE=sheets
APPS_SCRIPT_URL=<the Web app URL from A5>
```
Then:
```
npm run sheets -- secret          # creates GATEWAY_SECRET in .env (not shown)
npm run sheets -- init            # gives that secret to the Apps Script (first time only)
npm run sheets -- setup           # creates the tabs and columns in the registry Sheet
npm run sheets -- setup --test    # same in the TEST Sheet
npm run setup -- --username <your username>   # Groups 1–3 and the first Admin; shows a one-time password once
```
`npm start` now runs the app on this computer with the Google Sheet (http://localhost:8787).
In Windows PowerShell, npm drops the `--` and fails on `--username`/`--test`; run the script directly instead:
`node scripts/setup.ts --username <name>`, `node scripts/sheets.ts setup --test`.

## C. Cloudflare: publish the Worker
```
node scripts/wrangler.ts login    # opens the browser once to allow Wrangler on your Cloudflare account
npm run worker:secrets            # copies SESSION_SECRET, APPS_SCRIPT_URL, GATEWAY_SECRET from .env to the Worker
npm run deploy                    # builds and publishes; prints https://ep-case-log.<your-subdomain>.workers.dev
```
Open the printed address, sign in with the one-time password and choose your own. Add users in Settings → Users.
A custom domain can be added later in Cloudflare (Workers → ep-case-log → Settings → Domains & Routes).

This project keeps its own Wrangler sign-in in `~/.ep-registry-wrangler` (account Tarek.kamc), apart from the EP Workspace
sign-in (kamc.ep2026) on the same PC: always call Wrangler through `node scripts/wrangler.ts <command>`
(`whoami`, `deploy`, `rollback <id>`, …). `wrangler.jsonc` pins Tarek.kamc's `account_id`, so a deploy from the wrong
account fails. If the sign-in page does not open from a background shell, run the login in a normal terminal.

Without a browser (a cloud session): instead of `wrangler login`, an API token made from the **Edit Cloudflare Workers**
template, stored as the environment variable `CLOUDFLARE_API_TOKEN` (with `CLOUDFLARE_ACCOUNT_ID`), lets Wrangler run.

## Updating later
- App: `npm run deploy` (tests first: `npm run build && npm test && npm run e2e && npm run e2e:worker`).
- New dictionary fields: `npm run sheets -- setup` adds the missing columns (never removes or reorders).
- Apps Script changes: paste the new `Code.js`, then Deploy → Manage deployments → Edit → **New version**.

## Restore points
| Tag | Worker version | Sheet |
|---|---|---|
| `checkpoint-2026-10-23-live` | `136e845d-6ec4-4d0e-8aa1-b3b356b23850` | EP Case Log — Registry (daily backups in "EP Case Log Backups") |
| `checkpoint-2026-10-23-round2` | `307c74d6-bfcc-4fce-afe1-01b8bfb49e5e` | same Sheet, after `sheets setup` (48 columns, Structural, CohortTags) |
| (commit after `e154eb7`, round 3 device form + CHA line) | `a246be0b-69aa-4b64-9398-8df4bd90ed9e` | same Sheet, no Sheet change |
| `d081bd4` (L1 speed) | `79b163ee-7f64-47ec-94ef-6d312ab802b2` | same Sheet, no Sheet change |
| `ba680f2` (L2 local-first) | `89f24cb1-2452-458d-8650-e917c46a6f75` | same Sheet, no Sheet change; browsers keep a device copy (IndexedDB `kamc-registry-<user id>`) |
| `5f4c653` (L3 offline open + offline new case) | `f008ad2e-d051-4559-9584-271022ac6a8a` | same Sheet, no Sheet change; the last signed-in user is remembered per browser (localStorage `kamc-registry-me`) |
| `caab064` (field review phase 1: 164 fields hidden) | `18778f9e-4164-4ef9-9aef-71b3e8dbbcaf` | same Sheet, no Sheet change (hidden fields keep their columns) |

To go back: code `git checkout <tag>` (or `git reset --hard <tag>` on a branch);
live app `node scripts/wrangler.ts rollback <Worker version>`; data: copy the wanted Sheet backup.
If the Sheet columns changed after the tag, `npm run sheets -- setup` only adds columns, so old code still runs.

## Notes
- If the gateway secret is lost: in the Apps Script, Project Settings → Script properties → delete `GATEWAY_SECRET`,
  then `npm run sheets -- secret` (after removing the old line from `.env`), `init`, and `npm run worker:secrets`.
- Users and groups are cached by the Worker for up to 20 seconds, so disabling a user or a new password applies to
  other open sessions within 20 seconds.
- Typing in the Sheet by hand is possible but not checked by the app; edit through the app.
- Tested here: every server test against the Sheet store running the real `Code.js` on a fake spreadsheet, and every
  browser test against the Worker in Cloudflare's local runtime (`npm run e2e:worker`). Not tested here: a real Google
  account and a real Cloudflare deployment (they need the owner's accounts).
