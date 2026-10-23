# Handoff for the next chat — KAMC EP Registry (EP Case Log), 23 Oct 2026

Read this first, then `docs/MERGE_PLAN.md` (all owner decisions; R2-1 … R2-12 are this round) and `AGENTS.md`.
Owner: Dr. Tarek (EP consultant, not a developer). Reply in **Egyptian Arabic**, code and technical terms in English.
Work in steps, preview before building anything visible, multiple-choice questions, stop after each step.

## Where things are
- Code: `E:\EP_REGISTRY_REBUILD\EP LOG` = GitHub `tmaelmasry-hash/ep-case-log` (public). Branch `main`.
- **Local `main` is 6 commits ahead of GitHub (not pushed):** `394b2c3` part 1 · `81d0916` part 2 · `0da3e49` cohorts ·
  `d0152df` part 3 · `da0e246` part 4 (+ the handoff commit). Push only with the owner's yes.
- Restore point before round 2: tag `checkpoint-2026-10-23-live` (pushed). How to roll back: `docs/DEPLOY.md` → Restore points.
- Old app (reference, read only): `E:\EP_REGISTRY_REBUILD\ep-workspace` — EP Workspace, **still live** on
  `ep-workspace.pages.dev` with real data on the **kamc.ep2026** account, and still developed in another session
  (M-4b deployed 23 Oct, M-4c planned). The owner chose to start the new registry **empty** (no data copy, D10).

## Live deployment (still the phase-4 build, round 2 NOT deployed)
- App: https://ep-case-log.ep-registry-tarek.workers.dev — Cloudflare Worker `ep-case-log`, account **Tarek.kamc**
  (`cfcaa4…`), live version `136e845d…`.
- Google Sheet "EP Case Log — Registry" + bound Apps Script (web app "EP Case Log v1"), TEST Sheet
  "EP Case Log — TEST (synthetic data only)", daily backup 10:00 Riyadh. `.env` on this PC holds STORE=sheets,
  APPS_SCRIPT_URL, GATEWAY_SECRET, SESSION_SECRET (never print them).
- First Admin `admin`; the owner signed in and chose a password. `data/admin-password.txt` (git-ignored) holds an older
  one-time password — ask the owner whether to delete it. `data/test-admin-password.txt` = the TEST Sheet's admin.

## Round 2 status (all built and tested on the TEST Sheet locally; not deployed)
1. **Part 1** — name **KAMC EP Registry**, list called **Procedures**; typed fields save on leave/Enter/Done/close
   (no 0.9 s timer); palette A "calm clinical" (cool mist bg, blue buttons incl. Complete, amber In progress, red
   Delete/Cancel, green Completed text; one color per category); logo stays navy.
2. **Part 2** — category menu (`config/categories.json` + `shared/categories.ts`): Ablation / Devices / Diagnostic /
   Structural + Cohorts (Pilgrims by Hijri year, Follow-up due, Incomplete, Complications) + Unclassified; desktop
   sidebar, phone drawer from the left; several items at once; period presets incl. Hijri; filters kept; filtered
   Excel export (`/api/exports` scope CASES); group switcher "All" first.
3. **Custom cohorts** (R2-12) — Admin builds cohorts by rule (any coded/number/date field, All/Any) or by tag; tags in
   the new **CohortTags** tab; built-in cohorts can be renamed/recolored/hidden (never deleted).
4. **Part 3** — from EP Workspace `d84547d`: M-3 (48 fields, 15 codes, LAA closure section, Sheet tab "Structural"),
   M-4a (stroke / TIA / thromboembolism split; CHA₂DS₂-VASc reads them), M-4b (cardiomyopathy types multi-choice),
   M-1 (72 dynamic-form rules, `shared/rules.ts`, same evaluator for screen, save check, readiness; per procedure).
5. **Part 4** — duplicate warning (same MRN + date), search by MRN / No. / procedure, Dashboard follows the menu.

Tests at the end: `npm test` 207 passed · `npm run e2e` 60 passed · `npm run e2e:worker` 60 passed (one Worker test
failed once and passed on re-run).

## What to do next (ask the owner, one at a time)
1. **Push** the 6 local commits to GitHub.
2. **Deploy round 2** (owner's yes first): `npx wrangler whoami` must show **tarek.kamc@gmail.com** — the other
   session switches Wrangler to kamc.ep2026 on this PC. If not: `npx wrangler logout`, then `npx wrangler login`
   (owner signs in as Tarek.kamc). Then `node scripts/sheets.ts setup` on the **main** Sheet (adds the 48 columns,
   the Structural and CohortTags tabs; adds only), then `npm run deploy`, check the live site, record the new version
   id as a restore point in `docs/DEPLOY.md`.
3. Open questions for the owner:
   - Reminder (he asked): which individual form fields to remove (R2-9).
   - AF ablation by energy submenu? (energies field exists since M-3; he last said AF = First / Redo only.)
   - Leadless LVEP / CCM items under Devices? (codes exist since M-3.)
   - Other guideline SVTs (IST, junctional, multifocal AT) have no dictionary code — new codes need his approval.
   - New EP Workspace items (M-4c lead locations, …): ask before porting (his rule).
   - Slow Google Sheet: list ~10 s, case 4–7 s on the TEST Sheet (targets 3–4 s) — worth a separate look.
   - The New Case sheet is partly covered by the sidebar at ~800 px width.

## Working notes
- Preview: `.claude/launch.json` config `registry-test-sheet` runs the server on the TEST Sheet at :8787; after
  `npm run build`, restart the preview and clear the service worker in the page before checking.
- Windows: `npm run x -- --flag` loses the `--` in PowerShell; call `node scripts/….ts --flag` instead. Files use CRLF;
  prefer the Edit tool over sed/node string replaces with `\n`.
- Never edit `config/dictionary/*` by hand (copied from EP Workspace; see `config/dictionary/SOURCE.md`).
- Fake data only in tests (MRNs 999xxxx); never print secrets or the /exec URL.
