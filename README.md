# EP Case Log

Offline-first personal case log for cardiac electrophysiology procedures. Runs as an installable web app (PWA) on Windows (Edge/Chrome) and phones (Android Chrome, iOS Safari). English, LTR.

Independent implementation inspired by the *functionality* described in the public App Store listing of "EPLog" (iOS). No code, assets, icons or names were copied.

## Features
- **Cases**: date, MRN, age, sex, operator role, fluoro time; grouped by month; search (MRN, procedure, details, notes); filters (category, procedure, complications, missing CHA₂DS₂-VASc, has images).
- **Procedures** (several per case), structured fields with required-field validation:
  AF, flutter, VT, SVT, PVC/PAC and AV-node ablation; device implant (subtype, device type, manufacturer, leads); lead extraction; LAA closure; EP study; other.
- **CHA₂DS₂-VASc** (and sex-neutral CHA₂DS₂-VA) "at time of procedure", prompted only for AF, flutter, AV-node ablation and LAA closure; shown as a labelled badge, not colour only.
- **Complications** checklist + details; complication rate in stats.
- **Op note scan** (camera on phones, file on desktop) with Optimized / Original / B&W filters, rotate, rescan, undo. **Images** per case with captions.
- **Image inbox**: bulk-import images, assign to a case later.
- **Patients**: derived from MRNs, with case history.
- **Stats**: 30d / 90d / 12mo / All / Custom; KPIs, cases-by-month chart, procedures by category/type with %, complications. Updates live.
- **PDF case report** via the browser print dialog ("Save as PDF").
- **Backup / restore** (JSON incl. images, merge by newest record), **CSV export**, last-backup date, **Erase all** (type ERASE to confirm).
- Auto-save on every change, save indicator, undo for deletes, confirmations for destructive actions.
- **Optional sync** across devices via the bundled zero-dependency Node server (last-write-wins per record, deletes propagate).

## Run (merge phase 1: registry server with sign-in)
Requires Node 22.18 or newer (the server is TypeScript run directly by Node).

```bash
npm install
npm run build          # type-checks app + server, builds the app into dist/
npm run setup          # once: creates .env (SESSION_SECRET), Groups 1–3 and the first Admin; prints a one-time password
npm start              # http://127.0.0.1:8787  (app + /api)
```
Sign in as `admin` with the one-time password, choose your own, then add users in Settings → Users.
Lost the Admin password: `npm run setup -- --reset-admin-password`.

Development: `npm start` in one terminal and `npm run dev` in another (Vite on :5173 proxies /api to :8787).

Settings in `.env` (see `.env.example`): `PORT`, `HOST` (127.0.0.1 = this computer only), `STORE` (`file` | `memory`), `DATA_DIR`, `SECURE_COOKIES`.
Session cookies are `Secure`: use the app on `localhost`/`127.0.0.1`, or over HTTPS. Other devices on the network need HTTPS in front of the server (phase 4 moves hosting to Cloudflare).

## Data storage & backup
- **Accounts (server)**: `DATA_DIR/registry.json` (default `data/registry.json`): users (password hashes only), groups, activity log. Back it up by copying the file while the server is stopped.
- **Device**, database `ep-caselog` (stores `cases`, `images`, `meta`), per browser profile and origin. The app requests persistent storage; if not granted the browser may evict data under disk pressure.
- **Sync server**: `DATA_DIR/sync-db.json` (default `./data/sync-db.json`), written atomically. Back it up by copying that file.
- **Backup**: Settings → "Download full backup" (`ep-caselog-backup-YYYY-MM-DD.json`). Restore: Settings → "Restore / merge from backup".
- Data is unencrypted on disk and on the server. Follow your institution's policy on patient identifiers; prefer de-identified study numbers over real MRNs.

## Working on this code with Claude Code or Codex
See `AGENTS.md` (architecture, invariants, integration and feature-removal recipes). `CLAUDE.md` imports it.

## Tests
```bash
npm test               # unit tests (scoring, stats, merge, validation, backup/CSV, scan filters)
npm run build && npm run e2e   # Playwright E2E in Chromium, desktop 1366×820 and Pixel 7 profiles
```
