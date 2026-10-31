# Handoff for the next chat — KAMC EP Registry (EP Case Log), 30 Oct 2026 (late night)

Read this first, then `docs/SCREEN_REVIEW.md` (every screen decision and what each build step did),
`docs/MERGE_PLAN.md` (owner decisions R2-* / R3-*) and `AGENTS.md`.
Owner: Dr. Tarek (EP consultant, not a developer). Reply in **Egyptian Arabic**, code and technical terms in English.
Work in steps; show a preview before building anything visible; ask with multiple-choice questions; stop after each
step; **deploy only on his yes**; he asks before deploying every time ("Deploy now").

## START HERE (30 Oct, late night) — round 4 is merged and LIVE
State: `main` = round 4 merged (`ceb6347` + this handoff), **not pushed** (ask the owner before pushing).
**Live Worker `7ccc5cc3-76bc-4d20-aa7c-d998f475989a`** (30 Oct ~23:00). No Sheet change, Apps Script still Version 3.
Live JS checked: `assets/index-E0lxtg7u.js` has Data completeness and Next missing; `/api/completeness` answers 401
signed out. Rollback: `node scripts/wrangler.ts rollback c98e3ff1-6518-4cab-947a-6f4b61a232f5` (restore point tag
`checkpoint-2026-10-30-before-round4`; see `docs/DEPLOY.md`).
Tests on `main` before deploy: build ✓, unit 311 pass, e2e 100/100, e2e:worker 100/100.
What was done in this chat:
- The 4 branches below merged `--no-ff` one by one; the two section-grouping files became one `shared/completeness.ts`
  (case sheet `completenessBySection`, group matrix `completenessOf`, one counter `countCheck`, count names
  applicable / recorded / not_available / missing / ai_pending).
- Two new e2e specs fixed (Member refusal fetched from the page so the cookie goes; Next missing closes parts one by one).
- Look fixes from the screenshots: long section names wrap in the Completeness sheet; `#/completeness` uses 1200 px.
- Owner's answers after the review page https://claude.ai/artifact/EfWtzD5iYUBMWup5qbJ3EB (real screenshots, made-up
  data): Dashboard other types stay faded; Next missing count = where you are now ("1 of N"); Timeline newest first.
  Logged in `docs/MERGE_PLAN.md`.
- Owner asked for a preview page of what will change before each deploy (a review artifact with real screenshots and
  his open choices) — keep doing this.
**31 Oct, after midnight — R4-4 live:** Worker `d11bb402-ebd1-469b-9b70-614aeade36a1` (commit `d36f7dc`). Two
optional multi-choice DEVICE_IMPLANTS fields beside the unchanged `implant_indication`: "Reasons pacing indicated"
(NCDR #14731, shown for PPM / CRT / ICD dual / leadless) and "Reasons for generator replacement" (#7650, shown for
generator change / upgrade / downgrade / explant). Main + TEST Sheet got the 2 columns (Device_Procedures).
`scripts/migrate-r44.ts` (exact matches only) dry run found 0 cases on both Sheets, so nothing was written. Preview and
screenshots: https://claude.ai/artifact/WjPxfEUaGMD3JQNxo1X8V1 . main pushed; the 4 round 4 side sessions archived.
**31 Oct — R4-5 done.** Q-P3: keep the dictionary CSP rule (nothing built). Q-P4: capability show rules live, Worker
`904954b6-4fba-4fc2-ba5c-0c5ce4fd8188` (commit `d08c2d9`; table and screenshots
https://claude.ai/artifact/QUxAQrbuNBGckDnVGqEqXW ; rules DR-DV-03a/b, 04, 05, 07a/b/c, 08, DR-CSP-01a/b in
`config/rules.json`, tests `tests/server/qp4.test.ts`). Lower rate, tachytherapy, pulse width and CSP target stay hidden
by the field review. One real saved answer is now hidden (PPM dual, defibrillation testing "Not done"; kept).
**31 Oct — DR-DV-06 live** (Worker `7120cbb6-0bd3-47bb-9294-d3926dd2f8cd`, commit `8c8239e`): "Leadless channel
measurements" offered for leadless single / dual only (layout `show_when` on DEVICE_IMPLANT_CHANNEL_MEASUREMENTS; a
section with saved rows stays; the server refuses new rows for other types). Real Sheet had no channel rows.
**Next:** nothing open from round 4. Ask the owner what is next (postponed: 15 NCDR lead locations).

### Round 4 history (kept for reference)
**Restore point (owner asked for it before any merge):** tag `checkpoint-2026-10-30-before-round4` (= `97c77fe`, same
code as Worker `c98e3ff1`, Apps Script Version 3).

Decisions: `docs/MERGE_PLAN.md` → "Round 4 decisions" (R4-1 … R4-9). Preview the owner approved (Design canvas, 5
artboards, re-read before judging the builds): https://claude.ai/artifact/FEQTvEQdfT7s2qLWWtk5uE . Owner: "build what
you think fits", group matrix now too (no trial week planned). He wants a preview before anything visible and his yes
before each merge and each deploy.

**Status 30 Oct ~21:50: all four finished and committed** (each reports build + unit tests pass, its new e2e spec NOT
run, screens not checked in a browser): dash-click-filter `ad494f6` (spec `tests/e2e/dashclick.spec.ts`),
case-next-missing `57d531a` (`tests/e2e/round4case.spec.ts`), patient-timeline `f1c4169` (`tests/e2e/timeline.spec.ts`),
group-matrix `d6ac2a0`. Nothing merged into `main`.

Side sessions started 30 Oct ~21:10 from the previous chat (each in its own worktree, told: no e2e runs because of the
shared ports, `npm run build && npm test` only, commit on its own branch, no push to `main`, no deploy, no Sheet change):

| Session (open from the sidebar) | Session id | Branch (full ref) | Builds | Main files |
|---|---|---|---|---|
| Dashboard: click a month or type to filter | `local_f9412fb7-325c-435e-b20c-1969091a9870` | `refs/heads/claude/dash-click-filter-1f4ca2` | R4-6: click a month / type filters the Dashboard (via `case_ids` to `POST /api/dashboard`), Filtered bar + Clear, "a case can count in several types" note | `src/views/StatsView.tsx` |
| Case: Next missing button + Completeness sheet | `local_39d89cb7-52d2-4942-9c86-b759e1b725c4` | `refs/heads/claude/case-next-missing-05e3e1` | R4-7 "Next missing · 1 of 3" in the procedure sheet; R4-8 Completeness sheet from the case header (sections × recorded / N/A / missing / AI, Fix) | `src/views/CaseView.tsx`, a section-grouping function in `shared/` |
| Patient page: Timeline of recorded events | `local_efaa60df-9d91-446a-a08e-6e890170b9a4` | `refs/heads/claude/patient-timeline-9851b8` | R4-9 Cases / Timeline switch, events by their own dictionary date, "Without a date" box, no planned follow-ups | `src/views/PatientsView.tsx`, `shared/timeline.ts` |
| Admin: data completeness matrix for a group | `local_6dff1c52-1b74-4b8b-800a-3ef07ffc80c9` | `refs/heads/claude/group-matrix-8ad333` | R4-8 group part: paged Admin-only endpoint (e.g. `GET /api/completeness`), `#/completeness` screen linked from `#/admin`, Excel | `server/routes/*`, `shared/completeness.ts`, `src/views/CompletenessView.tsx`, `src/App.tsx` |

**Steps for the new chat (in order):**
1. For each session: read its last report (`mcp__ccd_session_mgmt__list_events` with the id above; they are not
   linked to the new chat, so no automatic note arrives). If one is still running, wait; if one stopped half-way, read
   its branch and finish it. A report is not proof: read each branch's diff (`git diff main...<ref>`).
2. Check overlaps before merging: the two "section grouping" functions (case-next-missing and group-matrix) should
   become one shared function; CSS added to `src/styles.css` by several branches; `src/App.tsx` routes.
3. Ask the owner (AskUserQuestion) to merge the four branches into `main` (name each by its full ref). Merge
   `--no-ff` one by one, resolve conflicts, unify the grouping function.
4. Full run on `main`: `npm run build && npm test && npm run e2e && npm run e2e:worker` (one at a time, in a Terminal
   panel tab so the owner sees it; stop leftover node / workerd on :8790 / :8793 / :8794 first; if Playwright says
   "Executable doesn't exist", `npx playwright install chromium-headless-shell`). Fix the new e2e specs the sessions
   wrote but did not run.
5. Show the owner the finished screens (local preview `registry-synthetic`, screenshots) against the canvas.
6. Ask "Deploy now?". On yes: `node scripts/wrangler.ts whoami`, `npm run deploy`, check live JS, add the restore point
   to `docs/DEPLOY.md`. Round 4 needs no `sheets setup` and no Apps Script change (check the diffs confirm this).
7. Update this file; tell the owner in Egyptian Arabic what changed on his screen; offer to archive the 4 sessions.

Still open (separate from the four ideas, each needs a preview / the owner's answer): R4-4 several pacing reasons and
generator-replacement reasons (show what it does first); R4-5 clinical rules Q-P3 (CSP section trigger) and Q-P4
(device / lead capability table), one at a time with their source. Postponed: 15 NCDR lead locations. NCDR dynamic
lists stay empty.

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

## Open items (ask the owner, one at a time)
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
