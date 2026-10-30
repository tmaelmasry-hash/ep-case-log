# Handoff for the next chat — KAMC EP Registry (EP Case Log), 30 Oct 2026 (night)

Read this first, then `docs/SCREEN_REVIEW.md` (every screen decision and what each build step did),
`docs/MERGE_PLAN.md` (owner decisions R2-* / R3-*) and `AGENTS.md`.
Owner: Dr. Tarek (EP consultant, not a developer). Reply in **Egyptian Arabic**, code and technical terms in English.
Work in steps; show a preview before building anything visible; ask with multiple-choice questions; stop after each
step; **deploy only on his yes**; he asks before deploying every time ("Deploy now").

## START HERE (30 Oct, night) — finish, test, deploy
State: `main` = `494b9ee`, pushed. **Live Worker `b8ed14a4`** (menu items). Apps Script live = **Version 2** (speed).
Merged into `main` but **NOT deployed**: (1) offline New case MRN note + re-check, (2) nightly backup as .xlsx
(`apps-script/Code.js`, not published), (3) device ticks saved with the case (Cases column `picked_items_json`),
(4) AVNRT: 5 accessory-pathway / AT questions hidden for AVNRT-only procedures (rules DR-SVT-01..05, owner approved,
`docs/AVNRT_QUESTIONS_PROPOSAL.md`). Unit/server 282 pass on merged `main`; full e2e not yet run on it.

**Steps left, in order (owner asks before each deploy step):**
1. **Holter fix:** branch `refs/heads/claude/holter-e2e-18423e` (`8beccaa` + `fc12adc` merge of main). Real app bug:
   Holter duration was sometimes never sent (lost on re-draw / close); fix keeps typed text in a ref
   (`src/components/Fields.tsx`) and the e2e waits for the save request. Its session
   ([holter-e2e](local_396fa710-e9ee-4d59-9a59-5912671020c3)) was running the full verification. Read its last report;
   if green, `git merge --no-ff refs/heads/claude/holter-e2e-18423e` into `main` (owner already said merge finished work).
2. Full run on `main`: `npm run build && npm test && npm run e2e && npm run e2e:worker` (stop leftover node on
   :8790/:8793/:8794 first). Push.
3. Ask the owner (AskUserQuestion) "Deploy now?". On yes:
   a. `node scripts/sheets.ts setup --test`, then `node scripts/sheets.ts setup` (main Sheet; only adds the Cases column
      `picked_items_json`) — **before** the Worker.
   b. `node scripts/wrangler.ts whoami` (account Tarek.kamc), `npm run deploy`; check the live JS; add the restore point
      to `docs/DEPLOY.md` (version from `node scripts/wrangler.ts deployments list`).
   c. Apps Script backup (.xlsx): publish in the **original** project only:
      `https://script.google.com/home/projects/1vJeEc6AWFMunPvx7WZcQzcrhqLEwlSFDRHjcpdft7EBDLptgxw_qHYdC/edit`
      (deployment "EP Case Log v1", id ends `…YxGBJY`). In the built-in browser (owner signs in to Google there): the
      clipboard does not reach it; load the code into Monaco from GitHub raw at the pushed commit
      (`monaco.editor.getEditors()` → `executeEdits` with the fetched text, then Ctrl+S, reload and check line count).
      Screenshots of the editor can lag: read the DOM. Dialogs open reliably at viewport 1400×900. Deploy → Manage
      deployments → Edit → Version: **New version** → Deploy (never New deployment). Then run `nightlyBackup` once
      from the editor (may ask for permission → the owner approves) and check a `.xlsx` appears in "EP Case Log Backups"
      and opens. Check the gateway still answers `read: api` (scratch script, see Open items). Rollback = Version 2.
4. Update this file and `docs/DEPLOY.md`; tell the owner in Egyptian Arabic what changed on his screen.

Side sessions (all idle, branches kept): offline-mrn-check, device-tick-server, backup-xlsx, avnrt-questions (all
merged), holter-e2e (step 1). Archive them only on the owner's yes.

Earlier today (live): Apps Script Version 2 = one Sheets API read (TEST: open case ~8 s → ~2 s); the deployment had
stayed on Version 1 because pastes went into backup copies (see `docs/DEPLOY.md` → Updating later). Menu: AF › By
energy; Devices › Other devices › Leadless LVEP / CCM; "Other device" tick. Other SVTs stay under Other SVT.

## Screen review build steps (27–30 Oct) — all live
| Step | What | Commit → Worker |
|---|---|---|
| 1 | Quick fixes: Pilgrims count, follow-ups 90 days, search MRN or procedure, title "Registry Cases", month counts | `26f6647` → `fbaf4dc7` |
| 2 | Case card (MRN big, age/sex, Hajj, N missing), quick periods, status filter, order, group colors, floating + (New case / Bulk add); **only the Admin adds cases** | `a57688c` → `bfad336f` |
| 3 | New Case (live MRN check, procedure date + Hijri), MRN prompt, type first, case screen, sections, Save draft, ≤5 choices = buttons | `f451fc5` → `bb82cd72` |
| 4 | Procedure sheet: fixed DONE row + tabs, parts that open and close, Mapping & access, Not available icon | `dfe5f02` → `9d50f4e9` |
| 5 | Navigation: My work first (done this week, fewest missing first), Follow-up tab (switched on), no Patients tab (patient page from the MRN), cohorts on the Dashboard (Admin only), menu order Ablation · Devices · Structural · Diagnostic, name → account, desktop empty pane | `14e943b` → `496eaa5c` |
| 6 | Settings (theme, text size, default group), Admin page `#/admin` (reset password + share, supervisor, AI show/hide), Move case (new number, old one in History), Bulk add planned type (Cases column `planned_type`, TEST + main), sign-in look | `bc3d7e1` → `1b6a1fa5` |
| 7 | Dashboard: period chips, "No change 14+ days", cases by month chart, Hajj season vs rest, Excel per table; statistics file (`POST /api/exports/stats`, values in words) | `e10e374` → `cc82b727` |
| 8 | Look: procedure colors (Devices teal, Pilgrims brown-gold), base text 17 px, dark mode edges, **Undo** instead of delete questions (deleter may restore a case within 60 s), messages at the top | `64a15d9` → `ff9096e3` |
| — | Open items: desktop sheets open beside the sidebar; Holter duration saves on close | `8245ec5` → `8a30e0a1` |

Previews (Design canvases, owner edits labels on them — re-read before changing and treat his edits as decisions):
step 5 https://claude.ai/artifact/3qxYL1dxu64Xy9xQB1j9jP · step 6 https://claude.ai/artifact/95pdJVfnbSoYqjHougXeT8 ·
step 7 https://claude.ai/artifact/7M5BGbQ3rqjwRqyf1T2xCM · step 8 https://claude.ai/artifact/SZf3eNGTkH25cZdDvGGdYA.
His Design-canvas edits can fail to save when his connection drops: list the canvas files and compare the version
before building.

## Open items (ask the owner, one at a time)
- **Labs tied to one procedure:** not possible, the dictionary links LAB_RESULTS to the episode only (owner had asked).
- **Offline new case MRN (merged 30 Oct, not deployed yet):** New Case shows "Offline: checked against cases on this
  device only." under the MRN; the outbox sends `known_case_ids`, `POST /api/cases` answers `other_cases` /
  `unseen_cases`; if the Sheet had cases the device did not know, one top message "MRN … already has N other case(s)
  in the Google Sheet." with **Open patient** (`#/patients/<mrn>`). Nothing is merged.
- The "Pacemaker / ICD / CRT" tick: **merged 30 Oct, not deployed** — saved with the case (Cases column
  `picked_items_json`, see `docs/SCREEN_REVIEW.md` → Device ticks). Deploy needs `node scripts/sheets.ts setup` on the
  main Sheet **before** the Worker (TEST done).
- Watch: the fieldreview e2e (Holter duration) failed now and then on e2e:worker mobile; the fix in `8245ec5` (saves
  on close) is the likely cause; it passed 84/84 since.
- Timing without a password: a scratch script calling the gateway (`.env` secret, target test, read ops) prints the
  gateway `ms` and `read`. `scripts/measure-speed.ts` needs a TEST admin password: `data/test-admin-password.txt` was deleted on the owner's
  yes (30 Oct, with `data/admin-password.txt`).

Known, told to the owner: accessory-pathway / AT questions still show under SVT ablation for AVNRT (existing rules);
"Others" = Tilt only (no other study in the dictionary).

## How things work now (for changes)
- Tabs (`src/App.tsx`): My work (`#/mywork`, default) · Cases · Follow-up (`features.followups`) · Dashboard (Admin,
  `dashboard.view`) · Settings; `#/admin` and `#/patients/<mrn>` have no tab.
- Device preferences: `src/lib/prefs.ts` (theme, text size 16/17/19/21 px, default group per user).
- Undo: `ed.removeWithUndo(rows, message)` in `src/caseEditor.tsx` hides rows at once and sends the removal after 7 s
  (at once when the case is left). Case delete: `POST /api/cases/:id/delete`, Undo = `/restore` (deleter within 60 s).
- AI switch: setting `ui.ai_visible` (`POST /api/settings/ui`) → `features.ai` in `/api/auth/me`.
- Statistics file: `server/domain/statsExport.ts`; real Excel dates via `{ date }` cells in `shared/xlsx.ts`.
- Cohorts: `CategoryTree show="cohorts"` on the Dashboard; the phone/desktop menu has no cohorts.

## Where things are
- Code: `E:\EP_REGISTRY_REBUILD\EP LOG` = GitHub `tmaelmasry-hash/ep-case-log` (public). Branch `main`, all pushed.
  github.com is sometimes unreachable from this PC: if a push fails, retry later and tell the owner.
- Restore points (commit → Worker version): `docs/DEPLOY.md` → Restore points. Rollback:
  `node scripts/wrangler.ts rollback <version>`. Apps Script rollback: Manage deployments → choose the older version.
- Old app (read only): `E:\EP_REGISTRY_REBUILD\ep-workspace` (EP Workspace, `ep-workspace.pages.dev`).

## Live deployment
- App: https://ep-case-log.ep-registry-tarek.workers.dev — Worker `ep-case-log`, account **Tarek.kamc** (`cfcaa4…`).
- **Wrangler: always `node scripts/wrangler.ts <cmd>`** (`whoami` first; own sign-in in `~/.ep-registry-wrangler`).
  Plain `npx wrangler` is the EP Workspace account (kamc.ep2026). Deploy: `npm run deploy` after
  `npm run build && npm test && npm run e2e && npm run e2e:worker`. Then add the restore point to `docs/DEPLOY.md`.
- Google Sheet "EP Case Log — Registry" (main) + TEST Sheet, one Apps Script serves both; `.env` holds the secrets
  (never print them). New columns: `node scripts/sheets.ts setup --test`, then `node scripts/sheets.ts setup` (only
  adds columns). Apps Script changes: in the **original** project only (id in `docs/DEPLOY.md`; backups copy the script), the owner
  pastes `apps-script/Code.js` and publishes a **new version** of the same
  deployment (copy it to his clipboard with PowerShell `Get-Content -Raw -Encoding UTF8 … | Set-Clipboard`).

## Working notes
- Local preview: `.claude/launch.json` → `registry-synthetic` (in-memory store, synthetic accounts, :8791; admin /
  synthetic-e2e-pass), `registry-test-sheet` (TEST Sheet, :8787). Seed cases through /api with the CSRF token from
  /api/auth/login (`component_` / `procedure_` id prefixes). After `npm run build` clear the service worker in the page.
- e2e:worker can leave `wrangler dev` (:8793) and the fake Apps Script (:8794) running after an interrupted run:
  stop those node processes before the next run. A slow first run can time out on desktop; rerun before judging.
- Windows: call `node scripts/….ts --flag` (npm loses `--`); commit messages via `git commit -F <file>`; git needs
  `-c user.name=Claude -c user.email=noreply@anthropic.com`. Files have CRLF: edit with a script that keeps CRLF, or
  the Edit tool. Long bash heredocs with quotes can fail in Git Bash: write the Python to a scratch file instead.
- Never edit `config/dictionary/*`. KAMC additions go in `config/local_amendments.json`; form changes in
  `config/case_layout.json` → `form`. Fake data only in tests (MRNs 999xxxx); never print secrets.

## Earlier work (all live)
- 24 Oct: field review (`docs/FIELD_REVIEW.md`; 363 keep · 164 hidden), `shared/derive.ts` app-filled values,
  `config/local_amendments.json` (FR3-1…6), Makkah Health Cluster colors (approximation, colors only).
- 27 Oct: Cancel discards a new procedure / row; page behind a sheet stays still.
