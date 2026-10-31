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
   and the daily backup at 10:00 Riyadh time (an **.xlsx** file in the folder **EP Case Log Backups**, newest 30 kept).
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
- **Which Apps Script project:** backups made up to 30 Oct (10:27) were Sheet copies *with* the script, so
  script.google.com lists one "EP Case Log — Registry" project per backup day. Only the original serves the app:
  project `1vJeEc6AWFMunPvx7WZcQzcrhqLEwlSFDRHjcpdft7EBDLptgxw_qHYdC` (created 23 Oct); open it at
  `https://script.google.com/home/projects/<that id>/edit`. In Manage deployments the **active** deployment is shown as
  "Untitled" (id ending `…YxGBJY`, the one in `.env`); "EP Case Log v1" is listed under Archived — always edit the
  active one and check the id ends `…YxGBJY`. A paste into a backup copy changes nothing. Check after publishing: the
  answer to a batch read carries `read: api` (scratch timing script, gateway `ms`).
- **.xlsx backup (published 30 Oct, Apps Script Version 3):** `nightlyBackup` saves an .xlsx export of the Sheet
  (`EP Case Log backup yyyy-MM-dd HHmm.xlsx`, same folder, newest 30 .xlsx kept) instead of a Sheet copy, so no new
  script projects appear. Older Sheet-copy backups in the folder are not touched or counted. It uses the export address
  the Excel export already uses (scope `script.external_request`, already granted). Checked 30 Oct: run once from the
  editor (no permission prompt, 3 s) → `EP Case Log backup 2026-10-30 2034.xlsx` in the folder, opens in Google Sheets
  with all 23 tabs. Restore: Google Sheets → File → Import
  → Upload the .xlsx → **Create new spreadsheet**.
- Faster reads (30 Oct): in the Apps Script editor, **Services (+) → Google Sheets API → Add** (keep the name
  `Sheets`). Code.js then reads every tab a request needs in one Sheets API request; without the service it reads tab
  by tab as before, so nothing breaks if it is missing. A date typed by hand into the Sheet is read from its display
  text (`2026-03-05`, `5/3/2026` in the Sheet's locale: day first unless the locale is en_US) and given back as
  `yyyy-MM-dd`; app-written text that is exactly a date in that form is given back the same way (accepted).

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
| `6f5e664` (field review phase 2: tick list, auto-fill, Done / Not done) | `2589911c-368c-44cc-9ec8-860968649243` | same Sheet, no Sheet change; the server now fills some values after each save |
| `6ccd591` (field review phase 3: KAMC local amendments) | `71edff53-2c3a-4e19-a4a0-436f8f0ba768` | main Sheet `sheets setup` 24 Oct: +5 columns (Patient 2, Imaging 3); old code still runs |
| `4655a38` (colors: Makkah Health Cluster palette) | `59a60ab8-5b61-4c4d-89e2-5305f4a09ed1` | same Sheet, no Sheet change; CSS colors only |
| `17f02af` (Cancel discards a new procedure / row; page behind a sheet stays still) | `67011dd4-bf41-4d39-a221-f87a27c2ebed` | same Sheet, no Sheet change |
| `26f6647` (screen review step 1: Pilgrims count, 90-day follow-ups, search, title, month counts) | `fbaf4dc7-a98d-4ce6-9590-a60e82537b5b` | same Sheet, no Sheet change |
| `a57688c` (screen review step 2: case card, quick filters, floating +, group colors; only the Admin adds cases) | `bfad336f-6a6e-4d14-8e04-0590e0994f6a` | same Sheet, no Sheet change |
| `f451fc5` (screen review step 3: New Case, procedure type first, case screen) | `bb82cd72-025d-43f5-83cd-5cfb7a2f0144` | same Sheet, no Sheet change |
| `dfe5f02` (screen review step 4: procedure sheet with tabs and parts) | `9d50f4e9-e29d-473a-bbec-06f3dabcc270` | same Sheet, no Sheet change |
| `14e943b` (screen review step 5: navigation, My work first, Follow-up tab) | `496eaa5c-a4e0-4881-8c17-eb38f99dcd1f` | same Sheet, no Sheet change |
| `bc3d7e1` (screen review step 6: Settings, Admin page, move case, bulk planned type, sign-in) | `1b6a1fa5-0cf6-4542-a3c6-4f3cdaa17aab` | same Sheet + Cases column `planned_type` (TEST and main, 29 Oct) |
| `e10e374` (screen review step 7: Dashboard chart, Hajj season split, statistics file) | `cc82b727-231b-4f05-a489-d87eb66a9a82` | same Sheet, no Sheet change |
| `64a15d9` (screen review step 8: colors, bigger text, dark mode, Undo) | `ff9096e3-c77c-46c1-9382-8ff64c435283` | same Sheet, no Sheet change |
| `8245ec5` (open items: desktop sheets beside the sidebar, Holter duration saves on close) | `8a30e0a1-e205-4734-85b3-da99a01ee4a3` | same Sheet, no Sheet change |
| `5030dfa` (Apps Script Version 2, 30 Oct: all tabs in one Sheets API read; Worker unchanged) | `8a30e0a1-e205-4734-85b3-da99a01ee4a3` | same Sheet; Apps Script rollback = Manage deployments → Edit → Version 1 |
| `5a1fa93` (menu: AF by energy, Devices › Other devices › Leadless LVEP / CCM; "Other device" tick) | `b8ed14a4-4f7f-44bf-a377-83bb2b67b409` | same Sheet, no Sheet change |
| `58b8349` (offline New case MRN note; device ticks saved with the case; AVNRT hides accessory-pathway / AT questions; Holter duration fix) | `c98e3ff1-6518-4cab-947a-6f4b61a232f5` | main Sheet + Cases column `picked_items_json` (30 Oct; TEST already had it). Apps Script **Version 3** (.xlsx nightly backup); Apps Script rollback = Version 2 |
| **`checkpoint-2026-10-30-before-round4`** (= `97c77fe`, same code as `58b8349`; set on the owner's request before the round 4 ideas are merged) | `c98e3ff1-6518-4cab-947a-6f4b61a232f5` | same Sheet (with `picked_items_json`); Apps Script Version 3. **Go back here if round 4 is not wanted** |
| `ceb6347` (round 4: Dashboard click filter, Next missing, Completeness sheet, Admin Data completeness `#/completeness`, patient Timeline; 30 Oct late night) | `7ccc5cc3-76bc-4d20-aa7c-d998f475989a` | same Sheet, no Sheet change; Apps Script Version 3 unchanged |
| `d36f7dc` (R4-4: several NCDR pacing reasons and generator-replacement reasons; 31 Oct) | `d11bb402-ebd1-469b-9b70-614aeade36a1` | main + TEST Sheet `sheets setup`: Device_Procedures +2 columns (`pacing_indication_reasons`, `generator_replacement_reasons`); old code still runs. R4-4 copy dry run: 0 cases to fill (TEST and main) |
| `d08c2d9` (R4-5 / Q-P4: device, lead and CSP capability show rules; 31 Oct) | `904954b6-4fba-4fc2-ba5c-0c5ce4fd8188` | same Sheet, no Sheet change. Read-only count before deploy: 1 saved answer now hidden (PPM dual, defibrillation_testing NOT_DONE; value kept) |
| `8c8239e` (DR-DV-06: leadless channel measurements for leadless single / dual only; 31 Oct) | `7120cbb6-0bd3-47bb-9294-d3926dd2f8cd` | same Sheet, no Sheet change; real Sheet had no saved channel rows |
| `bd315a8` (R4-3 / Q-F12: the 15 NCDR lead locations; 31 Oct) | `ee730343-e51e-4f91-b8fa-581a60b2baac` | same Sheet, no Sheet change (same column, new codes); real Sheet had no saved lead location |
| `929e584` (Q-R2: atypical flutter target for atypical only; extraction details for extraction / complete explant; 31 Oct) | `90c04ea3-c2c0-4ed0-a2a4-e4bdb6a8d75c` | same Sheet, no Sheet change; 1 saved answer now hidden (typical CTI flutter, atypical_flutter_target RA_FREE_WALL_LINE; kept) |

To go back to before round 4: if the round 4 merges are on `main` but not deployed, `git revert` the merge commits
(history kept) or, on the owner's yes, `git reset --hard checkpoint-2026-10-30-before-round4` + force-push; if round 4
was deployed, `node scripts/wrangler.ts rollback c98e3ff1-6518-4cab-947a-6f4b61a232f5` (round 4 adds no Sheet column and
no Apps Script change, so nothing else to undo).
To go back: code `git checkout <tag>` (or `git reset --hard <tag>` on a branch);
live app `node scripts/wrangler.ts rollback <Worker version>`; data: import the wanted .xlsx backup into a new Sheet
(older backups are Sheet copies: make a copy of the wanted one).
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
