# Handoff for the next chat — KAMC EP Registry (EP Case Log), 24 Oct 2026

Read this first, then `docs/MERGE_PLAN.md` (all owner decisions; R2-* round 2, R3-* round 3) and `AGENTS.md`.
Owner: Dr. Tarek (EP consultant, not a developer). Reply in **Egyptian Arabic**, code and technical terms in English.
Work in steps, preview before building anything visible (an HTML preview or an artifact), multiple-choice questions,
stop after each step, deploy only on his yes.

## START HERE
The owner is trying the live app (https://ep-case-log.ep-registry-tarek.workers.dev, his own account) and will name
the **next thing to fix**. Ask him what he found; do not start anything before that.

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
Tests now: unit/server 235 · e2e 68 · e2e:worker 68.

## Screen review (27–28 Oct)
Round 1 (New Case + case screen) answered, round 2 (main screen and the rest) open: `docs/SCREEN_REVIEW.md`. Nothing
built yet; preview each change first.

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
- Code: `E:\EP_REGISTRY_REBUILD\EP LOG` = GitHub `tmaelmasry-hash/ep-case-log` (public). Branch `main`, all pushed.
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
