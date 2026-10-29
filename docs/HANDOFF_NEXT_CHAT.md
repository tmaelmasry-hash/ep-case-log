# Handoff for the next chat — KAMC EP Registry (EP Case Log), 28 Oct 2026

Read this first, then `docs/MERGE_PLAN.md` (all owner decisions; R2-* round 2, R3-* round 3) and `AGENTS.md`.
Owner: Dr. Tarek (EP consultant, not a developer). Reply in **Egyptian Arabic**, code and technical terms in English.
Work in steps, preview before building anything visible (an HTML preview or an artifact), multiple-choice questions,
stop after each step, deploy only on his yes.

## START HERE — steps 1–6 live; step 7 (Dashboard and export) built and committed, deploy on the owner's yes; then step 8 (look)
The owner reviewed every screen (rounds 1 and 2, 28 Oct); all answers and the 8-step build plan are in
**`docs/SCREEN_REVIEW.md`** (read it whole). Steps 1–6 are live. **Step 5 (navigation)** was previewed
(https://claude.ai/artifact/3qxYL1dxu64Xy9xQB1j9jP), approved, built and deployed on 29 Oct (Worker `496eaa5c`): My work
first, Follow-up tab (switched on), no Patients tab (patient page from the MRN), cohorts on the Dashboard (Admin only),
menu order Ablation · Devices · Structural · Diagnostic, name → account, desktop empty pane. Details in SCREEN_REVIEW.md
→ "Step 5". Next: step 6 preview, then steps 6 (Settings and Admin), 7 (Dashboard and export), 8 (look) — see SCREEN_REVIEW.md.

How previews were done: a Design canvas artifact per step (phone screens 390 wide, the app's own colors, yellow notes
in Arabic). Step 3: https://claude.ai/artifact/Ld4BVxmXShvzcdqvg9G7uU · step 4:
https://claude.ai/artifact/RpV8FfXyD57sArrPvCyuL5. The owner edits labels directly on the canvas: re-read its files
before changing it and treat his edits as decisions. After building, check the look in the local preview
(`.claude/launch.json` "registry-synthetic", admin / synthetic-e2e-pass, fake MRNs 999xxxx; seed cases through
/api with the CSRF token from /api/auth/login) and clear the service worker after each build.

## Done on 24 Oct (all live, all pushed)
1. **Field review** (R2-9 / R3-5; full record `docs/FIELD_REVIEW.md`; review page
   https://claude.ai/artifact/Vxm8gc69gr5J3fuQgphLYr with `decisions` + `advice`). 363 keep · 164 hidden · 0 later.
   - Phase 1 (Worker `18778f9e`): `config/case_layout.json` → `form` (hidden, not_core, labels, code_order, offer,
     date_only, hajj_season), applied by `shared/dictionary.ts` `applyForm`. The dictionary is never edited; hidden
     fields keep their Sheet columns and values. 51 hidden fields are core or R/RC — owner confirmed.
   - Phase 2 (`2589911c`): procedure sheet "What was done" (17 items, `src/lib/procedureTypes.ts` PROCEDURE_ITEMS; the
     primary procedure type follows the ticks); `shared/derive.ts` = values the app fills (server `applyDerived` after
     every save, the browser overlays the same in `caseEditor.tsx`): procedure date from the episode date, type, Hajj
     timing (season 1 Dhu al-Qa'dah → 15 Muharram, rites 8–13 Dhu al-Hijjah), diagnosis + subtype (only into empty
     answers), eGFR (CKD-EPI 2021), CSP target, implant date precision, hidden links. Tilt and CMR / CT / TEE start with
     Done / Not done; Holter duration with a unit; "Device interrogation" row only when it applies; height / weight /
     BMI in Patient.
   - Phase 3 (`71edff53`): `config/local_amendments.json` (FR3-1…6: nationality list, residence category, PAC burden,
     Inpatient monitor, multi-choice valve lesion(s) and scar location(s)). Main and TEST Sheets got the 5 columns.
2. **Colors** (R3-6): palette derived from the Makkah Health Cluster identity, colors only (no logo / name / text).
   Navy `#15508A` accent, sky `#1592CE` highlight, `#1278B0` info / EPS; dark accent `#6FB6E6`. **Approximation** from
   the cluster's public website and emblem (no published codes found). Tokens in `src/styles.css`
   (`--accent`, `--highlight`, `--brand`, `--brand-deep`). Preview: https://claude.ai/artifact/YAAESity3hAwXZH687hbFj.
Colors deployed 24 Oct: commit `4655a38` → Worker `59a60ab8`. Cancel on a new procedure / row discards it, page behind a sheet stays still: `17f02af` → Worker `67011dd4` (27 Oct).
Tests now: unit/server 235 · e2e 72 · e2e:worker 72 (all passing at `aad8aea`).

## Screen review (27–29 Oct) — steps 1–5 live
| Step | What | Commit → Worker |
|---|---|---|
| 1 | Quick fixes: Pilgrims count, follow-ups 90 days, search MRN or procedure, title "Registry Cases", month counts | `26f6647` → `fbaf4dc7` |
| 2 | Case card (MRN big, age/sex, Hajj, N missing), quick periods, status filter, order, group colors, floating + (New case / Bulk add); **only the Admin adds cases** (untouched cases are My work of the group's Members) | `a57688c` → `bfad336f` |
| 3 | New Case (live MRN check, Procedure date + Hijri), MRN prompt, Add procedure = type first, case screen (header card, AI/Cohorts/History/Report icons, procedures with own dates), sections Patient & episode (sheet "Patient Demographics"), Medical History, Investigations & Medications (TEE/CT/CMR via layout row `values`), Follow-up, Notes; Save draft; ≤5 choices = buttons | `f451fc5` → `bb82cd72` |
| 4 | Procedure sheet: fixed DONE row + tabs (General / each type / Complications) that jump and follow the scroll, parts that open and close, Mapping & access part, Not available icon | `dfe5f02` → `9d50f4e9` |
| 5 | Navigation: My work first (done this week, fewest missing first), Follow-up tab (switched on), no Patients tab (patient page from the MRN), cohorts on the Dashboard (Admin), menu order, name → account, desktop empty pane | `14e943b` → `496eaa5c` |
| 6 | Settings (theme, text size, default group), Admin page (reset password + share, supervisor, AI show/hide), Move case, Bulk add planned type (Cases column `planned_type`), sign-in look | `bc3d7e1` → `1b6a1fa5` |

Known, told to the owner: accessory-pathway / AT questions still show under SVT ablation for AVNRT (existing rules);
Others = Tilt only (no other study in the dictionary).

## Open items (ask the owner, one at a time; none started)
- Labs cannot be tied to one procedure: the dictionary gives LAB_RESULTS only an episode link (owner had asked).
- The "Pacemaker / ICD / CRT" tick is remembered on the device (localStorage) until the device type is chosen.
- AF ablation by energy submenu; Leadless LVEP / CCM under Devices (no dictionary code); other SVTs without a code;
  new EP Workspace items (M-4c…) — ask before porting.
- Optional speed: a new Apps Script version reading all tabs in one call (first open of a case ~5–6 s); needs the
  owner to paste Code.js and publish a new version.
- The New Case sheet is partly covered by the sidebar at ~800 px width.
- Offline new case checks the MRN only against cases on that device.
- `data/admin-password.txt` (git-ignored) holds an old one-time password — ask whether to delete it.

## Where things are
- Code: `E:\EP_REGISTRY_REBUILD\EP LOG` = GitHub `tmaelmasry-hash/ep-case-log` (public). Branch `main`, all pushed (28 Oct). github.com is sometimes unreachable from this PC: if a push fails, retry later and tell the owner.
- Restore points (commit → Worker version): `docs/DEPLOY.md` → Restore points. Rollback:
  `node scripts/wrangler.ts rollback <version>`.
- Old app (read only): `E:\EP_REGISTRY_REBUILD\ep-workspace` (EP Workspace, `ep-workspace.pages.dev`).

## Live deployment
- App: https://ep-case-log.ep-registry-tarek.workers.dev — Worker `ep-case-log`, account **Tarek.kamc** (`cfcaa4…`).
- **Wrangler: always `node scripts/wrangler.ts <cmd>`** (`whoami` first; own sign-in in `~/.ep-registry-wrangler`).
  Plain `npx wrangler` is the EP Workspace account (kamc.ep2026). Deploy: `npm run deploy` after
  `npm run build && npm test && npm run e2e && npm run e2e:worker`.
- Google Sheet "EP Case Log — Registry" (main) + TEST Sheet; `.env` holds the secrets (never print them). New fields
  need `node scripts/sheets.ts setup --test`, then `node scripts/sheets.ts setup` (only adds columns).

## Working notes
- Local preview: `.claude/launch.json` → `registry-synthetic` (in-memory store, synthetic accounts, :8791; test
  password from `tests/e2e/helpers.ts`), `registry-test-sheet` (TEST Sheet, :8787), `previews` (:8799, mockups in
  `.claude/previews`). After `npm run build` clear the service worker in the page.
- Windows: call `node scripts/….ts --flag` (npm loses `--`); commit messages with quotes via `git commit -F <file>`;
  git needs `-c user.name=Claude -c user.email=noreply@anthropic.com`. Files have CRLF: prefer the Edit tool.
- Never edit `config/dictionary/*`. KAMC additions go in `config/local_amendments.json`; form changes in
  `config/case_layout.json` → `form`. Fake data only in tests (MRNs 999xxxx); never print secrets.
