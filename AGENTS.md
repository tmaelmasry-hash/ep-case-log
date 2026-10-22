# EP Case Log — guide for coding agents (Claude Code, Codex)

Offline-first personal logbook for cardiac electrophysiology procedures. React 18 + TypeScript + Vite PWA; data in browser IndexedDB; optional zero-dependency Node sync server. English UI, LTR.

This file is the single source of truth for agents. `CLAUDE.md` imports it.

> **Merge in progress (EP Workspace features into this app).** Read `docs/MERGE_PLAN.md` first: owner decisions, build order and phase status. Where this file and MERGE_PLAN differ, MERGE_PLAN wins. Phases 1–2 are done: `server/` is the registry server (sign-in, Admin/Member, users, cases). Cases are server-side, one case = one EP_EPISODE with several EP_PROCEDURES; all clinical fields come from `config/dictionary/` (never edit) arranged by `config/case_layout.json`; shared logic in `shared/`. The old local-only modules (IndexedDB store, catalog, images, backup) described below were removed in phase 2.

## Commands

```bash
npm install
npm run dev        # Vite dev server :5173 (proxies /api → :8787)
npm run build      # tsc --noEmit + vite build → dist/
npm run setup      # once: .env SESSION_SECRET, Groups 1–3, first Admin (one-time password)
npm start          # node server/main.ts → app + /api on 127.0.0.1:8787 (Node ≥ 22.18 runs the TypeScript directly)
npm test           # Vitest unit tests (tests/unit) — pure logic, no browser
npm run e2e        # Playwright E2E (needs `npm run build` first; desktop + Pixel 7 profiles)
```
Run `npm run build && npm test && npm run e2e` before declaring a change done. The E2E suite starts `node server/main.ts --e2e` on :8790 (in-memory store, synthetic accounts admin / sara / newbie, password from `E2E_PASSWORD`).

## Architecture (3 layers, dependencies point downward only)

```
views/*  components/*        React UI (no direct IndexedDB access)
        │
     store.tsx                React context: in-memory state, mutations, autosave, undo toasts, sync scheduling
        │
     lib/*                    Pure TS logic + IndexedDB + sync client. No React imports.
        │
server/                       Registry server: handleApi(Request) → Response (api.ts), auth/, routes/, store/ (RegistryStore: memory, file; Sheet in phase 4). WebCrypto only.
```

### `src/lib/` — reusable logic (lift these first when integrating)
| File | Responsibility | Depends on |
|---|---|---|
| `types.ts` | Data model: `CaseRec`, `Procedure`, `ChaInputs`, `ImageRec`, `ImageMeta`, `BackupFile`, `SyncFields` | — |
| `catalog.ts` | Procedure catalog (types, categories, icons, structured field definitions), complications list, roles, `procSummary`, `missingRequired`, `numberError` | types |
| `cha.ts` | CHA₂DS₂-VASc and CHA₂DS₂-VA scoring; which procedures require it (`needsCha` in catalog) | catalog, types |
| `stats.ts` | Date ranges (30d/90d/12mo/all/custom), `computeStats` (counts, by month with gap-filling, by category/type with %, complication rate) | catalog, util |
| `util.ts` | ids, date formatting/parsing (local dates, `YYYY-MM-DD`), case field validation, CSV escaping, download helper | — |
| `merge.ts` | Last-write-wins merge (`shouldAccept`, `mergeInto`) used by import and sync | types |
| `db.ts` | IndexedDB wrapper. DB `ep-caselog` v1, stores `cases`, `images` (keyPath `id`), `meta` (key/value) | types |
| `sync.ts` | Sync client: push dirty records in ≤4 MB batches to `/api/push`, pull pages from `/api/pull?since=` | db, merge |
| `backup.ts` | JSON backup build/parse (validates untrusted input), CSV export | catalog, cha, util |
| `image.ts` | Image normalisation (max 2000 px JPEG + 240 px thumb), rotate, scan filters (`optimized` percentile stretch, `bw` Otsu threshold) | — (browser canvas) |

### `src/store.tsx`
`StoreProvider` + `useStore()`. Loads everything from IndexedDB at start, keeps `cases` and image **metadata** (no full `dataUrl`) in memory, and exposes mutations: `createCase`, `updateCase`, `deleteCase`, `addImages`, `updateImage`, `deleteImage`, `getImage` (full image from IDB), `importRecords`, `exportAll`, `eraseAll`, `saveSyncConfig`, `runSync`, `toast`. Every mutation updates state optimistically, then persists, sets `saveStatus`, marks `_dirty`, and schedules a sync (1.5 s debounce; also every 60 s and on `online`).

### `src/views/` and `src/components/`
| File | Screen / role |
|---|---|
| `App.tsx` | Shell: hash router (`#/cases[/id]`, `#/inbox`, `#/patients[/mrn]`, `#/stats`, `#/settings`), bottom tab bar (narrow) or sidebar + two-pane cases (≥960 px), loading/fatal states, preview banner when iframed |
| `views/CasesView.tsx` | Case list grouped by month, search, filter sheet, `CaseRow`, `ProcChip`, `ChaBadge`, `matchesSearch` |
| `views/CaseInfoSheet.tsx` | Create/edit case header (date, MRN with autocomplete, age, sex, role, fluoro) with validation |
| `views/CaseDetail.tsx` | Case screen: procedures, CHA sheet, complications sheet, op note scan, images, notes (saved per keystroke), delete |
| `views/ProcedureSheets.tsx` | Procedure picker grid and generic form renderer driven by `catalog.ts` field definitions |
| `views/Images.tsx` | `ImageEditor` (filter/rotate/rescan/undo), `ImageViewer` (caption/move/delete), `Thumb` |
| `views/InboxView.tsx` | Unassigned images; bulk import; assign to case |
| `views/PatientsView.tsx` | Patients derived from MRNs (no separate patient table) |
| `views/StatsView.tsx` | KPIs, SVG cases-by-month chart, procedures by type, complications |
| `views/SettingsView.tsx` | Backup/restore/CSV, sync settings, storage estimate, erase all, about |
| `views/CaseReport.tsx` | Printable report rendered into `#print-root` via portal; `window.print()` → Save as PDF |
| `components/ui.tsx` | `Sheet`, `Confirm` (optional type-to-confirm), `Toasts`, `Segmented`, `ChipSelect`, `Empty`, `SaveIndicator`, `useHashRoute`, `useMediaQuery` |
| `components/Icon.tsx` | Inline stroke SVG icons (original paths) |
| `styles.css` | All styles; color tokens on `:root`, dark mode via `prefers-color-scheme` and `[data-theme]`, print rules |

### Other
- `public/sw.js` — service worker (network-first navigation, cache-first assets, never caches `/api`). `vite.config.ts` plugin `precache-sw` injects the built file list and a cache version at build time.
- `server/` — ported from EP Workspace: `auth/auth.ts` (PBKDF2, signed cookie, epoch, lockout), `auth/capabilities.ts` (Admin/Member rights), `api.ts` guard (session, Origin, CSRF, forced password change), `routes/auth.ts`, `routes/admin.ts`, `node.ts` (serves dist/ + /api), `main.ts`. Env in `.env` (see `.env.example`).

## Data model invariants (do not break when merging)
1. Every synced record has `id` (UUID), `createdAt`, `updatedAt` (ms). Any edit **must** bump `updatedAt` (store does `max(Date.now(), prev+1)`).
2. Deletes are soft: `deleted: true` tombstones, so they propagate through sync/import. UI lists filter them out.
3. `_dirty: 1` is local-only (pending push). `stripLocal()` removes it before sending/exporting.
4. Conflict rule is per-record last-write-wins (`merge.ts`, mirrored in the server's `accept()`); ties broken deterministically by JSON comparison. Keep client and server rules identical.
5. Dates are local calendar strings `YYYY-MM-DD`; never parse with `new Date('YYYY-MM-DD')` (UTC shift) — use `parseISO` in `util.ts`.
6. Images: full `dataUrl` lives only in IndexedDB; memory holds `ImageMeta` (thumb). `caseId: null` = inbox. `kind`: `'image' | 'opnote'`.
7. Patients are derived by grouping cases on `mrn`.
8. CHA₂DS₂-VASc is relevant only when a case contains a procedure with `needsCha: true` (AF, flutter, AV node ablation, LAA closure). Age/sex points come from the case, not the inputs object.

## Adding or changing a procedure type
Edit only `PROCEDURES` in `src/lib/catalog.ts`: `type` (stable key — never rename once data exists), `label`, `category`, `icon` (key in `Icon.tsx`), `fields[]` (`segmented | select | multi | number | text | toggle`, `required`, `min/max/unit`), optional `needsCha`. The form, summary line, filters, stats, CSV and PDF all derive from it. Add a unit test for the summary/required behaviour.

## Integration recipes

**A. Reuse logic only (any framework):** copy `src/lib/` (+ `tests/unit/`). It has no React dependency. `db.ts`/`sync.ts`/`image.ts` need a browser; the rest is pure and runs in Node.

**B. Embed the feature set in another React app:** copy `src/lib/`, `src/store.tsx`, `src/components/`, `src/views/`, `src/styles.css`. Wrap the host route with `<StoreProvider>`. Then:
- Routing: `useHashRoute` + `href="#/…"` links are used throughout (`App.tsx`, `CasesView`, `CaseDetail`, `PatientsView`, `InboxView`). Replace with the host router or keep the views under a hash-routed sub-app.
- CSS is global with generic class names (`.card`, `.row`, `.btn`, `.sheet`…). Prefix/scope it (CSS modules, a wrapper class, or rename) to avoid collisions; tokens are `--bg`, `--card`, `--text`, `--accent`, `--cat-*` on `:root`.
- Change `DB_NAME` in `db.ts` if the host already uses IndexedDB; keep the DB name stable afterwards or users lose data.
- `index.html` needs `<div id="print-root"></div>` for the PDF report.

**C. Use this as the base of the other app and remove features** — each is self-contained:
| Remove | Delete / edit |
|---|---|
| Sync | `lib/sync.ts`, `server/` (or keep it only to serve files); in `store.tsx` remove sync state, `runSync`, `scheduleSync`, `saveSyncConfig`, the periodic effect; Sync section in `SettingsView`; sync parts of `SaveIndicator`; sync test in `tests/e2e` |
| Images / op note / inbox | `lib/image.ts`, `views/Images.tsx`, `views/InboxView.tsx`; image sections in `CaseDetail`; inbox button + `imgCount` in `CasesView`; `images` store usage in `store.tsx`/`backup.ts`/`CaseReport.tsx`; inbox route in `App.tsx` |
| CHA₂DS₂-VASc | `lib/cha.ts`; `needsCha` flags; `ChaSheet` + badges in `CaseDetail`/`CasesView`/`PatientsView`; CHA columns in `backup.ts`; `cha` field in `CaseRec` (keep the field if old backups must still import) |
| Stats | `lib/stats.ts`, `views/StatsView.tsx`, tab entry in `App.tsx` |
| Patients tab | `views/PatientsView.tsx`, tab entry in `App.tsx` |
| PDF report | `views/CaseReport.tsx`, button in `CaseDetail`, print CSS |
| Offline/PWA | `public/sw.js`, `precache-sw` plugin, registration in `main.tsx`, manifest link |
After removing, run `npx tsc --noEmit` to find dangling imports, then update tests.

## Conventions
- TypeScript strict; no `any`. Functional components + hooks. No state library beyond React context.
- Destructive actions: `Confirm` dialog and/or undo toast (`toast({ message, undo })`). Never delete without one of these.
- Validation lives in `lib` (`validateCaseFields`, `missingRequired`, `numberError`) so it is unit-testable; views only display messages.
- Lists have empty states; storage failures surface as an error toast (save) or the fatal screen (load).
- Keep UI text English/LTR (`<html lang="en" dir="ltr">`). For RTL/Arabic, set `dir="rtl"` and replace physical CSS properties (`left/right`, `margin-left`, `padding-left`, `.is-wide .main { margin-left }`, sidebar `inset`) with logical ones.

## Known limitations
- No encryption at rest (IndexedDB, backup JSON, server file). No user accounts; sync auth is a single shared token.
- LWW sync relies on roughly correct device clocks; concurrent edits to the same case are not field-merged.
- All case records are loaded into memory; fine for thousands of cases, untested beyond that. Images are stored as base64 data URLs.
- Service worker and install need HTTPS or localhost.
- E2E covers Chromium only (desktop 1366×820 and Pixel 7 emulation); not tested on Safari/iOS or real devices.
