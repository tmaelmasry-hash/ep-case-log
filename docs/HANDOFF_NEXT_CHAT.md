# Handoff for the next chat — KAMC EP Registry (EP Case Log), 24 Oct 2026

Read this first, then `docs/MERGE_PLAN.md` (all owner decisions; R2-* round 2, R3-* round 3 + local-first) and `AGENTS.md`.
Owner: Dr. Tarek (EP consultant, not a developer). Reply in **Egyptian Arabic**, code and technical terms in English.
Work in steps, preview before building anything visible, multiple-choice questions, stop after each step.

## START HERE — colors (owner, 24 Oct)
The field review is **done and live** (record: `docs/FIELD_REVIEW.md`; review page
https://claude.ai/artifact/Vxm8gc69gr5J3fuQgphLYr). Next task, asked by the owner: change the app colors to the
**Makkah Health Cluster** visual identity, colors only (no logo, name or text), centralised in the CSS tokens
(`src/styles.css` `:root` + both dark blocks; also the few literal colors such as `.pill-set button.on` white text).
- Preview (private artifact) waiting for the owner's yes: https://claude.ai/artifact/YAAESity3hAwXZH687hbFj —
  accent navy `#15508A` (buttons, chosen answers, active menu, links), sky `#1592CE` for highlights / progress /
  charts; dark: accent `#6FB6E6`. Category, warning and success colors unchanged; device / EPS chips follow the blues.
- These values are an **approximation** from the cluster's public website stylesheet and emblem (no published brand
  guideline found); say so. Do not use the old KAMC palette. Check contrast; check desktop and phone, light and dark.

## Field review (done 24 Oct, Workers 18778f9e → 2589911c → 71edff53)
- Phase 1: 164 fields hidden by `config/case_layout.json` form (dictionary untouched; Sheet columns stay), labels,
  choice order, Procedure date only, chosen answers in blue.
- Phase 2: procedure "What was done" list (17 items) with the type set automatically; `shared/derive.ts` fills Hajj
  timing (season 1 Dhu al-Qa'dah → 15 Muharram), diagnosis, eGFR, procedure date, links; Done / Not done for tilt and
  imaging; Device interrogation row; height / weight / BMI in Patient.
- Phase 3: `config/local_amendments.json` (nationality list, residence category, PAC burden, Inpatient monitor,
  multi-choice valve lesions and scar locations); main and TEST Sheets have the 5 new columns.

## Where things are
- Code: `E:\EP_REGISTRY_REBUILD\EP LOG` = GitHub `tmaelmasry-hash/ep-case-log` (public). Branch `main`, **all pushed**.
- Restore points (Worker versions + tags): `docs/DEPLOY.md` → Restore points.
- Old app (reference, read only): `E:\EP_REGISTRY_REBUILD\ep-workspace` — EP Workspace, still live on
  `ep-workspace.pages.dev` (kamc.ep2026 account), still developed in another session. New registry started empty (D10).

## Live deployment (everything below is live, 24 Oct)
- App: https://ep-case-log.ep-registry-tarek.workers.dev — Worker `ep-case-log`, account **Tarek.kamc** (`cfcaa4…`),
  live version `f008ad2e…`.
- **Wrangler: always `node scripts/wrangler.ts <cmd>`** (own sign-in in `~/.ep-registry-wrangler`, Tarek.kamc).
  Plain `npx wrangler` is the EP Workspace sign-in (kamc.ep2026). `wrangler.jsonc` pins `account_id`.
  If the login page does not open from a background shell, run the login in a terminal tab.
- Google Sheet "EP Case Log — Registry" (main) + TEST Sheet; `.env` holds the secrets (never print them).
- `data/admin-password.txt` (git-ignored) holds an old one-time password — ask the owner whether to delete it.

## Done this round (all deployed)
1. Round 2 (parts 1–4 + cohorts) + main Sheet `sheets setup`.
2. R3-1/2/3: device procedures get their own form (type ticks its component; device + leads inside the device
   procedure; mapping/ICE only for ablation; transseptal for AF, LAA, flutter, SVT/AP/VT); CHA₂DS₂-VASc only as a
   line inside Baseline risk profile.
3. Local-first (R3-4): **L1** one Sheet call per save (row_version check, caches); **L2** device copy + outbox +
   background sync, indicator + Sync sheet; **L3** opens offline (remembered sign-in), new case offline ("No. pending"),
   online-only actions greyed. Sign out keeps the device copy (owner).
Tests: unit/server 217 · e2e 66 · e2e:worker 66.

## What to do next (ask the owner, one at a time)
- The owner has not yet saved a real case on the live site after local-first; ask how it feels (speed, indicator).
- Open questions: AF ablation by energy submenu;
  Leadless LVEP / CCM under Devices; other SVTs without dictionary code; new EP Workspace items (M-4c…) — ask first.
- Optional speed: a new Apps Script version reading all tabs in one call (opening a case the first time ~5–6 s);
  needs the owner to paste Code.js and publish a new version.
- The New Case sheet is partly covered by the sidebar at ~800 px width.
- Known limit: offline new case checks the MRN only against cases on that device.

## Working notes
- Preview: `.claude/launch.json` `registry-test-sheet` (server on the TEST Sheet at :8787, `SHEETS_DEBUG=1` logs Sheet
  calls) and `previews` (static mockups in `.claude/previews` at :8799). After `npm run build`, restart the preview
  and clear the service worker in the page. `node scripts/measure-speed.ts` times list/open/save on the TEST Sheet.
- Windows: `npm run x -- --flag` loses the `--` in PowerShell; call `node scripts/….ts --flag`. Commit messages with
  quotes: use `git commit -F <file>`. Git needs `-c user.name=Claude -c user.email=noreply@anthropic.com`.
- Never edit `config/dictionary/*` by hand. Fake data only in tests (MRNs 999xxxx); never print secrets.
