# Merge plan: EP Workspace features into EP Case Log

Owner decisions (Dr. Tarek, 21 Oct 2026, step 2 multiple-choice). Source read: `EP_Workspace_source_2026-10-21.zip` (commit `ff48639`), read only, never run.

## Decisions
| # | Decision |
|---|---|
| D1 | Code base: **EP Case Log** (React + TypeScript). Owner chose this over the recommended "start from EP Workspace code" after the trade-off was explained (more work, higher risk). |
| D2 | Runtime: **same system as EP Workspace** — server, username sign-in, Admin/Member, groups, Google Sheet via Apps Script, Cloudflare. Portable EP Workspace parts (domain rules, dictionary forms/config, tests) are ported, not rewritten from memory. |
| D3 | Clinical fields: **dictionary only**. EP Case Log's own procedure/complication/CHA input fields are removed and replaced by dictionary entities and codes. Nothing invented. |
| D4 | Case model: **case = EP_EPISODE** with one or more `EP_PROCEDURES` (dictionary hierarchy PATIENT → EP_EPISODES → EP_PROCEDURES; each procedure keeps its `PROCEDURE_COMPONENTS`). Replaces EP Workspace A7 (one case = one procedure). Readiness, categories, dashboard and Sheet layout must handle several procedures per case. |
| D5 | Real EP Workspace data: **one-time copy at the very end**, rehearsed on synthetic data first, real import only with explicit owner approval. The live registry is never modified. |
| D6 | Kept from EP Case Log: **Patients screen**, **CHA₂DS₂-VASc display** computed from dictionary fields (`CLINICAL_PROFILE_SNAPSHOTS` heart_failure, hypertension, diabetes, prior_stroke_tia_systemic_embolism, vascular_disease + age + sex_at_birth), never stored. **PDF case report** kept, rebuilt on dictionary fields (saved values only, no generated wording). |
| D7 | Removed from EP Case Log: images, op-note scan, image inbox, its own sync server / local-only mode, invented fields. |
| D8 | Brought from EP Workspace: Bulk add MRNs, AI Assistant, MRN prompt + copy-forward, Light follow-up, Excel export, Dashboard + My work, Follow-up bell (built switched off, as in F-19). Not brought: Reports templates + WhatsApp. |
| D9 | Accounts/hosting: the owner's Google Apps Script account and Cloudflare account (Workers & Pages), named 22 Oct 2026. They hold test items only; the owner asked to delete them. Clean-up is done from a session on the owner's computer (`docs/ACCOUNTS_CLEANUP_HANDOFF.md`), list first, delete only confirmed items. Phases 1–3 run on a local store with synthetic data. |
| D10 | Clean slate (owner, 23 Oct 2026): after being shown that the accounts held the EP Workspace registry Sheet "EP Registry — Rebuild" with its nightly backups and the Pages project `ep-registry-rebuild`, the owner said to delete everything and treat the new registry as brand new. The owner moved all EP Registry Drive files (Sheets, backups, export folders, their bound scripts) to Drive Trash; Apps Script My projects is empty. Still to do by the owner: delete the Cloudflare Pages project `ep-registry-rebuild`; empty Drive / Apps Script Trash if wanted (Cloudflare project deleted by the owner the same day). **Correction (23 Oct):** what was deleted was an older copy on Tarek.kamc; the real EP Workspace (`ep-workspace.pages.dev`, Sheet on kamc.ep2026) is untouched and still running. Told this, the owner chose to **start the new registry empty, with no data copy**: phase 13 stays dropped by the owner's choice. Supersedes D5. |

## Build order (owner approved)
1. Server, sign-in, Admin/Member
2. Dictionary forms, case = episode with several procedures, remove old fields
3. Groups + numbering, readiness, Completed/Reopen, Not available, history, recycle bin, activity log
4. New Google Sheet via Apps Script (owner account steps)
5. MRN prompt + copy-forward
6. Bulk add MRNs
7. Light follow-up
8. Patients + CHA₂DS₂-VASc display
9. Dashboard + My work
10. Excel export
11. AI Assistant (needs API key)
12. Follow-up bell (off)
13. ~~One-time copy of real EP Workspace data (explicit approval)~~ dropped by D10

## Round 2 decisions (owner, 23 Oct 2026, after comparing with EP Workspace)
Restore point before this round: tag `checkpoint-2026-10-23-live` (see `docs/DEPLOY.md`).

| # | Decision |
|---|---|
| R2-1 | App name **KAMC EP Registry** (title, manifest, sign-in, PDF). The main list is called **Procedures** (first item "All procedures"); a row is still a case/episode and shows under every category it matches. |
| R2-2 | Typed fields save **on leaving the field / Enter / Done / closing the sheet**, not after a 0.9 s pause (`src/components/Fields.tsx`); errors show only after leaving. |
| R2-3 | Colors (owner changed his first pick after seeing it, 23 Oct): **palette A "calm clinical"** (owner switched from B to A after seeing B, 23 Oct), several calm colors, not one: background "cool mist" #F2F5FB, actions/Done blue #2F62D6, Complete button blue like Done (owner, 23 Oct); Completed pill bright emerald #10B455 (text #077A37); sheet Cancel red, In progress/warnings amber #9A6200 on #FDF0D5, Delete/errors red #C8323C, info teal #2E8FB0; one color per category (`--cat-af`, `--cat-flutter`, `--cat-svt`, `--cat-ap`, `--cat-avn`, `--cat-vent`, `--cat-eps`, `--cat-dev`, `--cat-laa`, `--cat-pilgrim` in `src/styles.css`), light and dark. Logo and app icon stay **navy** as before. |
| R2-4 | Category menu: sidebar on desktop, the same tree in a ☰ drawer on phones; parents open their children on click; counts follow the active filters; config-driven (one file maps each item to dictionary codes). Tree: **Ablation** (AF ablation › First / Redo / by energy after M-3; Flutter › Typical CTI / Atypical; SVT › AVNRT / Atrial tachycardia; Accessory pathway ablation (AVRT_WPW); AV node ablation; Ventricular › PVC / Idiopathic VT / Scar VT › Ischemic / Non-ischemic / Other) · **Diagnostic EP study** · **Devices** (Pacemaker › Single / Dual / Leadless; ICD › Single / Dual / S-ICD / EV-ICD; CRT › CRT-P / CRT-D; Conduction system pacing › LBBAP / His / HOT-CRT / LOT-CRT; Extraction and revision › Lead extraction / System explant / Lead revision / Pocket revision; Generator change and upgrade; ILR; Other devices › Leadless LVEP / CCM) · **LAA closure** · **Patient groups**: Pilgrims › Hajj › by Hijri year / Umrah › by Hijri year / Non-pilgrim / Not recorded; Follow-up due › Due / Overdue; Incomplete; Complications · **Unclassified** (automatic, hidden when empty). Items with 0 stay visible. |
| R2-5 | Pilgrim status always comes from `EP_EPISODES.pilgrim_status` as entered; the year sub-list is the Hijri (Umm al-Qura) year of the case date. For **Hajj**, a case dated in Muharram counts toward the previous Hijri year's season (owner, 23 Oct). |
| R2-6 | Filters combine (procedure menu + patient group + period); **Export to Excel of the filtered result** (Admin all groups, Member own group). |
| R2-7 | Bring from EP Workspace: **M-1** dynamic form rules, **M-3** 48 fields + 15 codes (local amendments), **M-4a** stroke / TIA / thromboembolism split. Cohorts: Hajj & Umrah, Follow-up due, Incomplete, Complications. |
| R2-8 | New: period filter (From–To + presets), duplicate warning (same MRN + same date), Dashboard follows the selected category, wider search (MRN, No., procedure). |
| R2-9 | Nothing is removed as a feature. The owner will name individual fields to remove later (remind him). |
| R2-10 | Build order: (1) timer + name + colors, (2) sidebar / filters / pilgrims / export, (3) M-4a, M-3, M-1, (4) R2-8 extras. Each part on the TEST Sheet with a preview first; deploy only with the owner's yes. |

## Working rules
- Stop after each step; previews (screenshots) before building anything visible; multiple-choice questions.
- Fake data only in tests; never copy secrets; ask before anything that could change or lose real data.
- Replies to the owner in Egyptian Arabic; code and technical terms in English.

## Preview decisions (step 3, round 1)
| # | Decision |
|---|---|
| V1 | Procedures inside an episode: one row per procedure in the PROCEDURES group (opens its sheet), plus "Add Procedure" (updated by V5). |
| V2 | Procedure state on the card reads "Procedure: <status>" (neutral pill) so it is never confused with the case's data-collection status In progress / Completed. No code changes. |
| V3 | CHA₂DS₂-VASc: no number until every risk item (and age, sex) is Yes/No/known; until then "CHA₂DS₂-VASc: incomplete". |
| V4 | General look (owner, round 2): **closer to EP Log** — iOS grouped-list style (large titles, inset grouped rows, uppercase section headers, segmented controls, bottom tab bar; light sidebar on desktop). Own icons and wording; no EP Log assets, logo or name. |
| V5 | Case page as EP Log: header card, then grouped rows (Procedures, Patient & history, Complications, Studies & follow-up, Additional clinical information); each row opens its form in a sheet (Cancel / Done), like EP Log's procedure sheet. This replaces EP Workspace's all-fields-inline page (its F-12) — **confirmed by the owner** on phone and desktop. |
| V6 | Cases grouped by month (EP Log) with group segmented control above; row = date · MRN · age/sex, procedure chips, labelled CHA₂DS₂-VASc chip, No. · status · core progress. |

**Step 3 approved (owner):** EP Log-style look (preview2, 5 screens: sign-in, cases list, case, procedure sheet, desktop) is the build target.

## Phase 1 — server, sign-in, Admin/Member (built 22 Oct 2026)
- Ported from EP Workspace (`server/auth/*`, `server/http.ts`, `server/api.ts`, `routes/auth.ts`, `routes/admin.ts`): PBKDF2-SHA256 (100k), signed HttpOnly SameSite=Lax cookie with session_epoch, CSRF = HMAC(session id), Origin check, lockout after 10 failures (15 min), IP throttle 30/15 min, forced password change, 12 h / 30 days ("Keep me signed in"), capability map A11. WebCrypto only (Cloudflare-ready).
- Local store: `server/store/file.ts` (data/registry.json) behind the `RegistryStore` interface; Google Sheet store comes in phase 4.
- UI: sign-in, choose-own-password, Settings → My account (change password, sign out with confirm), Settings → Users (Admin: add with generated or typed password, "send to the user" text, edit name/role/groups, new password, disable/enable, unlock).
- Removed: EP Case Log's own sync server and sync client (D7). Consequence: the app now needs the server to open (no offline start).
- Cases are still kept in each browser until phase 2 moves them to the server with the dictionary fields.
- Tests: tests/server/auth.test.ts (21), browser tests tests/e2e/auth.spec.ts + existing flows signed in (22 runs over desktop + phone).

## Phase 2 — dictionary forms, case = episode with several procedures (built 22 Oct 2026)
- Dictionary files copied unchanged from EP Workspace into `config/dictionary/` (37 entities, 545 fields + EXT_PROCEDURE_REVIEW); provenance in `config/dictionary/SOURCE.md`. `config/case_layout.json` only arranges them: scope case / procedure, nest_under, modules by component type, auto_parent; FOLLOW_UPS and OUTCOME_EVENTS marked `later: phase 7`.
- Shared code (`shared/`): dictionary builder, value validation ported from EP Workspace validate.ts (codes, subsets, ranges, dates, other_specify), MRN rules (7 digits, Arabic/Persian digits), slot ids for one-per-scope rows (EP Workspace P1b-6).
- Server: cases stored whole (`RegistryStore` putCase/getCase/listCases/allocateSeq), `server/domain/cases.ts` applies creates/changes/removes per item with field-level last save wins; routes list/create/read/edit/delete; group scope (Members see own groups, others = 404); activity keeps field names only.
- New case = PATIENT_IDENTIFIERS + PATIENTS (enrollment_date today, registry_basis default) + EP_EPISODES (status OPEN). Cases of one MRN share patient_id. Group numbering No. 1, 2…
- Procedures: any number per episode; each has its PROCEDURE_COMPONENTS (sequence auto-numbered), the modules its components call for (AF, flutter, SVT, ventricular, AVJ, EPS, device implant, CRT/CSP, ILR, lead), complications review + complications. Removing a procedure removes its rows.
- UI (approved EP Log style): cases list by month with group switcher; case page header + PROCEDURES + Patient & history + Studies & follow-up + Additional clinical information; every section opens in a sheet; controls chosen by dictionary type; core fields marked ★.
- Removed from EP Case Log: invented fields (catalog), images/op note/inbox, old PDF report, JSON/CSV backup, IndexedDB store (old local database deleted on first open, owner-approved). CHA₂DS₂-VASc display returns in phase 8 from dictionary fields; PDF report on dictionary fields in phase 8.
- Not yet: readiness/Completed/Not available/history/recycle-bin screen (phase 3), Google Sheet (4), MRN prompt + copy-forward (5), follow-up (7).
- Tests: tests/server/cases.test.ts (18) + auth (21); browser tests 24 runs (desktop + phone).

## Phase 3 — readiness, Completed / Reopen, Not available, history, groups, recycle bin, activity log (built 22 Oct 2026)
Owner decisions (step 2, phase 3): core fields are checked **for each procedure**, including the category items of that procedure's components; **Reopen by Admin and Member**, with a reason; phase 3 preview (11 screens) approved.
- Readiness ported from EP Workspace `server/domain/core.ts` into `shared/readiness.ts` (server enforces, browser shows). Case-level items (patient, episode, diagnosis, risk profile, echo; device items once per case) are checked once; EP_PROCEDURES / procedure-section items and category items (AF_ABLATION, SVT_ABLATION, DEVICES from `config/dictionary/core_dataset.json`) for each procedure. Category ← component types: `config/case_layout.json` `core_categories`, copied from EP Workspace `config/categories.json`. `when` conditions, `complete_if` (complications reviewed) and "complications present needs one complete complication" kept. Date of birth "not available" = warning only.
- "Not available" + reason (4 EP Workspace reasons or a typed one, ≤200 chars) only on empty applicable core fields; never on complications reviewed; a value replaces it; removing a procedure removes its entries. Stored per case as `not_available` (key `ENTITY.field` or `ENTITY.field@<procedure id>`).
- Mark completed only with no missing core field (409 NOT_READY; 409 STALE_CASE if the case changed). Completed cases are read only (edits 409 CASE_COMPLETED; the UI hides add/remove and shows values). Reopen needs a reason (kept in history). Completing never changes clinical values (procedure status untouched).
- Case history inside the case: who, when, before → after (dictionary labels/codes), "Not available", add/remove, complete/reopen, delete/restore. One person typing in one field within 2 minutes = one line. Shown only inside the case; values never go to the activity log.
- Groups: Admin adds (numbering starts at No. 1) and renames (numbers unchanged; names unique); "+" in the case-list group switcher. Recycle bin (Admin): restore with the old number. Activity log (Admin): field names only; one person's edits to one case within 2 minutes = one line; filter by MRN or person.
- Owner decision (22 Oct 2026): device implant core fields (DEVICE_IMPLANTS) apply only to procedures with a Device implant component — ILR or lead management alone do not need them (`core_item_requires_component` in `config/case_layout.json`). Changes EP Workspace's DEVICES core set for those procedures. The case device (DEVICES type, manufacturer) is still checked once for any device procedure. Module sections a procedure's core fields need are shown in its sheet.
- Settings keeps the Users list inline below the new Admin rows (Groups, Recycle bin, Activity log); the preview showed Users as a row.
- Tests: tests/server/phase3.test.ts (10) + earlier (39) = 49; browser tests tests/e2e/phase3.spec.ts (3) + earlier (12) = 30 runs (desktop + phone). Mutation checks: removing the completion check or the "has a value" guard makes the tests fail.

## Phase 4 — Google Sheet + Apps Script + Cloudflare Worker (built 22 Oct 2026; deployment waits for the owner's accounts)
- `apps-script/Code.js` copied from EP Workspace (thin gateway: read / append / update cells under a lock, gateway secret set once, daily backup, Excel export for phase 10); names changed to EP Case Log.
- `server/store/sheets.ts` (SheetsStore) + `sheet-layout.ts`: Cases tab (key columns, core done/total, "not available" and additional information as JSON), one tab per family of dictionary tables (`ENTITY__field` columns, one row per dictionary row, `row_key` = case/entity/row), History, Users, Groups, Activity.
- Saves write only the cells that changed (`server/store/patch.ts`); the local stores use the same patches. Two people saving different fields of one case at once both keep their values.
- `worker/index.ts` + `wrangler.jsonc`: one Cloudflare Worker serves the app and `/api` (security headers on every page). Config is bundled at build (`scripts/build-config.ts`); the server no longer reads files at run time.
- Owner steps and commands: `docs/DEPLOY.md` (`npm run sheets -- secret | init | setup`, `npm run setup`, `npm run worker:secrets`, `npm run deploy`).
- Tests: server tests run twice (memory store, and Sheet store over the real Code.js on a fake spreadsheet) + `tests/server/sheets.test.ts`; browser tests run against the local server and against the Worker in Cloudflare's local runtime (`npm run e2e:worker`). A mutation check (writing whole rows instead of changed cells) makes the concurrency test fail.
- Not done here: the real Google Sheet and Cloudflare deployment (owner's accounts; cleanup of test items first, `docs/ACCOUNTS_CLEANUP_HANDOFF.md`).
- **Deployed 23 Oct 2026** (session on the owner's computer, after D10 clean-up): Google Sheet "EP Case Log — Registry" with bound Apps Script (web app "EP Case Log v1"), TEST Sheet and daily 10:00 backup from `setupSheets`; `sheets init/setup` (+ `--test`) done; first Admin `admin` with Groups 1–3. Worker `ep-case-log` on the owner's Cloudflare account Tarek.kamc (cfcaa4…): https://ep-case-log.ep-registry-tarek.workers.dev. Checked: page 200 with security headers, `/api` answers, a wrong sign-in reads the Users tab through Apps Script (401 INVALID_LOGIN, ~3.4 s). Not yet checked: owner's first sign-in and a full case save on the live site.

## Phases 5–12 (built 22 Oct 2026; owner asked to finish all phases, test, try locally, then deploy last)
- **5 MRN prompt + copy-forward:** POST /api/cases answers 409 MRN_HAS_CASES unless `new_case: true`; history sections marked `copy_forward` in `config/case_layout.json` are copied from the latest case of the same MRN and tagged "Copied" until edited.
- **6 Bulk add MRNs:** `server/domain/bulk.ts`, `/api/imports` (claim → review → add), Imports tab; episode start date optional.
- **7 Light follow-up:** FOLLOW_UPS / OUTCOME_EVENTS belong to a procedure (index event = that procedure); quick events.
- **8 Patients + CHA₂DS₂-VASc + PDF report:** `shared/cha.ts` (V point = `vascular_disease` only, per D6 — owner to confirm), `CaseReport.tsx`.
- **9 Dashboard + My work:** `server/domain/dashboard.ts`, rules in `config/site.json` → `dashboard`.
- **10 Excel export:** `shared/xlsx.ts` (no dependency), `/api/exports` (whole registry for Admin, own group for Members); the Sheet store exports through Apps Script.
- **11 AI Assistant:** `server/ai/*`, `server/routes/ai.ts`. Provider chosen by the Admin in Settings (Test AI by default; Claude/Gemini/OpenAI need an API key in `.env` / Worker secrets). Note de-identified before sending, never stored; values filled only into empty fields, marked "AI" and blocking Complete until accepted; conflicts never overwrite saved values. Test AI answers only the synthetic notes in `config/ai_fixtures.json`.
- **12 Follow-up bell (off):** `server/domain/followups.ts`, `/api/followups`, `config/site.json` → `followup_due.enabled: false`. Switch on: set `true` and redeploy.
- **Try-it demo:** `npm run build:demo` → `dist-demo/ep-case-log-demo.html`: the same app and server code running inside one page on made-up cases kept in that browser (`demo/`). Excel download and printing do not work inside the preview frame.
- Tests at the end of phase 12: 150 server/unit tests (memory + Sheet store), 50 browser runs (desktop + phone), 50 browser runs against the Cloudflare Worker + fake Apps Script (all passing).
