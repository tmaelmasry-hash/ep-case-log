# Handoff for the next chat — KAMC EP Registry (EP Case Log), 31 Oct 2026

Read this first, then `docs/MERGE_PLAN.md` (every owner decision: R2-* / R3-* / R4-* and the 31 Oct answers),
`docs/DEPLOY.md` (restore points and rollback), `docs/SCREEN_REVIEW.md` (screen decisions) and `AGENTS.md`.
Owner: Dr. Tarek (EP consultant, not a developer). Reply in **Egyptian Arabic**, code and technical terms in English.

## How the owner wants to work
- Work in steps and stop after each one. Ask with multiple-choice questions (AskUserQuestion), recommendation first.
- **Preview before building anything visible**, and **a review page before every deploy**: an HTML artifact in
  Egyptian Arabic, RTL, with real screenshots from the local synthetic preview (made-up MRNs 9990xxx), what changed,
  fixes found from the screenshots, and the open choices (then ask them). Examples:
  https://claude.ai/artifact/EfWtzD5iYUBMWup5qbJ3EB (round 4) · https://claude.ai/artifact/QUxAQrbuNBGckDnVGqEqXW (Q-P4).
- **Deploy only on his "Deploy now"**; Sheet changes (`npm run sheets -- setup`) and data copies only on his separate yes.
- Before deploy: full run `build → test → e2e → e2e:worker` in a Terminal panel tab he can watch (the scratchpad
  script `full-run.ps1` of the last chat did this; recreate it if needed). After deploy: check the live JS, add a row to
  `docs/DEPLOY.md` → Restore points, update this file, push `main` (he agreed to pushes after deploys).
- Never delete a saved value: when a show rule hides a question, first count real answers it would hide (read only,
  codes and counts only, no MRN) and tell him; the value stays in the Sheet and Excel.

## START HERE — state on 31 Oct 2026: everything is live, nothing half-done
- `main` = `fa9e60b` + this handoff commit, **pushed** to GitHub. Working tree clean (only the untracked `.claude/`).
- **Live Worker `4787751b-c9b8-44ec-9b25-1ae70cab8587`** (Q-S1). Apps Script live = **Version 3** (unchanged since 30 Oct).
- Main + TEST Sheet: Device_Procedures got 2 columns on 31 Oct (`pacing_indication_reasons`,
  `generator_replacement_reasons`); later on 31 Oct Ablation_EPS +1 (`prior_af_ablation_strategies`) and Imaging +2
  (`lv_hypertrophy`, `ra_size_category`) for Q-S1.
- Last full test run (31 Oct, Q-S1): build ✓, unit 357 pass, e2e 102/102, e2e:worker 104/104; the new
  `tests/e2e/ncdrLists.spec.ts` passes on both setups.
- Side sessions: none running (the 4 round 4 sessions are archived).
- Rollback to before round 4: `node scripts/wrangler.ts rollback c98e3ff1-6518-4cab-947a-6f4b61a232f5` (tag
  `checkpoint-2026-10-30-before-round4`). Every later Worker version is listed in `docs/DEPLOY.md`.

### Live since 30 Oct (in order; details in MERGE_PLAN / DEPLOY)
| What | Commit → Worker |
|---|---|
| Round 4: Dashboard click filter, Next missing ("1 of N" = where you are), Completeness sheet in the case, Admin `#/completeness` matrix + Excel, patient Timeline (newest first). One `shared/completeness.ts` for case sheet and matrix | `ceb6347` → `7ccc5cc3` |
| R4-4: several NCDR pacing reasons (#14731) and generator-replacement reasons (#7650) beside the unchanged `implant_indication`; `scripts/migrate-r44.ts` (exact matches only) found 0 cases to copy | `d36f7dc` → `d11bb402` |
| Q-P3 (keep dictionary CSP rule, nothing built) + Q-P4 capability show rules (programmed mode, defibrillation testing, lead threshold / impedance, shock impedance, CSP capture) | `d08c2d9` → `904954b6` |
| DR-DV-06: leadless channel measurements for leadless single / dual only (layout `show_when`) | `8c8239e` → `7120cbb6` |
| R4-3 / Q-F12: the 15 NCDR lead locations (8 new codes, NCDR names, coarse Epicardial / Subcutaneous not offered) | `bd315a8` → `ee730343` |
| Q-R2: atypical flutter target for atypical only; extraction details for extract / complete explant | `929e584` → `90c04ea3` |
| Q-R1 closed: spec rules I3B and E5 stay yellow warnings (live since 21 Oct) | — |
| Q-P1: device pathway tag ICD / Pacemaker / Leads only on case cards, My work, case header (`shared/pathway.ts`) | `5014eae` → `ffc4fd45` |
| Q-S1: NCDR printed list values (`docs/NCDR_LISTS_Q-S1.md`): Anxiety + Irregular heartbeat (symptoms), Ethanol (energies used), prior AF ablation strategies (11 values, redo only, rule DR-NCDR-3), echo LV hypertrophy + RA size. Product lists are NCDR Master files, not public → model stays text | `ebc281b`, `fa9e60b` → `4787751b` |

Real data hidden by the new rules (values kept in the Sheet): 1 PPM dual with defibrillation testing "Not done";
1 typical CTI flutter with atypical target "RA free wall line" (both In progress cases).

### Still open (only these)
1. Nothing is open from round 4, the EP Workspace question ledger (its file in `ep-workspace/docs/merge/` is out
   of date: Q-P1…P4, Q-R1, Q-R2, Q-F12, Q-C4, Q-M3-3 are all answered — see MERGE_PLAN), or the postponed items.
   Ask the owner what is next.

### Lessons (Windows PC)
- A laptop that sleeps during `npm run e2e` makes one test hang ~30 min and fail; re-run that spec alone.
- After a reload the app shows the device copy first, then the server copy: e2e checks of counts must wait
  (`expect.poll`), not read once.
- In bash scripts never start with a bare `cat > file` without input (it waits forever); write files with the Write tool.
- Local preview with data: start `registry-synthetic` (:8791, in-memory), sign in admin / `synthetic-e2e-pass`, and seed
  made-up cases through the API (the last chat's scratchpad seed scripts are gone with that chat; rewrite: login →
  `POST /api/cases` with `new_case: true` → `PATCH /api/cases/:id` with `creates` / `changes`).

---

## Earlier (30 Oct, night) — everything merged before round 4 is live
State: `main` = `dd9e835`, pushed. **Live Worker `c98e3ff1`** (30 Oct ~20:30). Apps Script live =
**Version 3** (.xlsx nightly backup; gateway checked `read: api`, 730 ms). Main Sheet got the Cases column
`picked_items_json` (TEST already had it).
Live since this deploy: (1) offline New case MRN note + re-check, (2) nightly backup as .xlsx (run once: `EP Case Log
backup 2026-10-30 2034.xlsx`, opens with all 23 tabs), (3) device ticks saved with the case, (4) AVNRT: 5
accessory-pathway / AT questions hidden for AVNRT-only procedures (DR-SVT-01..05, `docs/AVNRT_QUESTIONS_PROPOSAL.md`),
(5) Holter duration fix (`426325c`: typed text kept in a ref in `src/components/Fields.tsx`; e2e waits for the save).
Tests on `main` before deploy: unit 49 files pass, e2e 88/88, e2e:worker 88/88.
Rollback: Worker `node scripts/wrangler.ts rollback b8ed14a4-4f7f-44bf-a377-83bb2b67b409`; Apps Script → Manage
deployments → Edit the **active** deployment ("Untitled", id `…YxGBJY`; "EP Case Log v1" is archived) → Version 2.

**Next:** nothing pending from the deploy. Ask the owner what is next (open items below), one at a time.

Lessons from this run (Windows PC):
- Playwright's `headless_shell.exe` vanished from `%LOCALAPPDATA%\ms-playwright\chromium_headless_shell-1194` (folder
  left, exe gone) → every e2e "fails" with "Executable doesn't exist". Fix: `npx playwright install chromium-headless-shell`.
- A Ctrl-C'd / stopped e2e:worker leaves `wrangler dev` (node) alive, and it keeps restarting `workerd` on :8793, so the
  next run hangs or the runtime "crashes". Stop the leftover `wrangler dev` / playwright / fakeAppsScriptServer node
  processes by PID (ask the owner: the auto-mode classifier blocks killing processes), or quit the app. Do not run
  `e2e` and `e2e:worker` at the same time: `e2e:worker` rebuilds `dist/`.
- The owner wants long runs visible: run tests/deploys in a Terminal panel tab, not in the background.
- After the desktop app restarts, the built-in browser may lose the Google sign-in (owner signs in again, 2-Step code).

Side sessions offline-mrn-check, device-tick-server, backup-xlsx, avnrt-questions, holter-e2e: archived 30 Oct
on the owner's yes (all merged and live).

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

## Notes from 30 Oct (all closed or for information; nothing to do)
- **Labs tied to one procedure:** not possible, the dictionary links LAB_RESULTS to the episode only (owner had asked).
- **Offline new case MRN (live 30 Oct, Worker `c98e3ff1`):** New Case shows "Offline: checked against cases on this
  device only." under the MRN; the outbox sends `known_case_ids`, `POST /api/cases` answers `other_cases` /
  `unseen_cases`; if the Sheet had cases the device did not know, one top message "MRN … already has N other case(s)
  in the Google Sheet." with **Open patient** (`#/patients/<mrn>`). Nothing is merged.
- The "Pacemaker / ICD / CRT" tick: **live 30 Oct** — saved with the case (Cases column `picked_items_json`, TEST and
  main, see `docs/SCREEN_REVIEW.md` → Device ticks).
- Timing without a password: a scratch script calling the gateway (`.env` secret, target test, read ops) prints the
  gateway `ms` and `read`. `scripts/measure-speed.ts` needs a TEST admin password: `data/test-admin-password.txt` was deleted on the owner's
  yes (30 Oct, with `data/admin-password.txt`).

Known, told to the owner: "Others" = Tilt only (no other study in the dictionary).

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
