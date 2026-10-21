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

## Run
Requires Node 18+ (tested with Node 22).

```bash
npm install
npm run build
npm run serve          # http://localhost:8787  (app + sync API)
```
Options: `PORT=8787 HOST=0.0.0.0 SYNC_TOKEN=<secret> DATA_DIR=./data npm run serve`.

Development: `npm run dev` (Vite on :5173; `/api` proxied to :8787).

### Install as an app
Open the URL in Chrome/Edge (Windows/Android) → "Install app", or Safari (iOS) → Share → "Add to Home Screen".
Note: service workers and the install prompt require **HTTPS or localhost**. To use phones on the LAN, put the server behind HTTPS (e.g. Caddy, a reverse proxy, or Tailscale Serve). Over plain HTTP on a LAN IP the app still works online but will not install or run offline.

### Sync
1. Run the server with `SYNC_TOKEN` set.
2. On each device: Settings → Sync → Server URL + token → Save → Test connection.
3. Syncs automatically on change (1.5 s debounce), every 60 s, and on reconnect; or "Sync now".
Conflict rule: the most recently edited version of each case/image wins (device clocks should be roughly correct). Without a server, the app is fully local.

## Data storage & backup
- **Device**: browser IndexedDB, database `ep-caselog` (stores `cases`, `images`, `meta`), per browser profile and origin. The app requests persistent storage; if not granted the browser may evict data under disk pressure.
- **Sync server**: `DATA_DIR/sync-db.json` (default `./data/sync-db.json`), written atomically. Back it up by copying that file.
- **Backup**: Settings → "Download full backup" (`ep-caselog-backup-YYYY-MM-DD.json`). Restore: Settings → "Restore / merge from backup".
- Data is unencrypted on disk and on the server. Follow your institution's policy on patient identifiers; prefer de-identified study numbers over real MRNs.

## Tests
```bash
npm test               # unit tests (scoring, stats, merge, validation, backup/CSV, scan filters)
npm run build && npm run e2e   # Playwright E2E in Chromium, desktop 1366×820 and Pixel 7 profiles
```
