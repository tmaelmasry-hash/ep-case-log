import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { buildBackup, casesToCsv, parseBackup } from '../lib/backup';
import { pingServer } from '../lib/sync';
import type { BackupFile } from '../lib/types';
import { downloadBlob, fmtDateTime, todayISO } from '../lib/util';
import { Icon } from '../components/Icon';
import { Confirm } from '../components/ui';

function useStorageEstimate(dep: unknown) {
  const [est, setEst] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  useEffect(() => {
    (async () => {
      if (!navigator.storage?.estimate) return;
      const e = await navigator.storage.estimate();
      const persisted = (await navigator.storage.persisted?.()) ?? false;
      setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0, persisted });
    })().catch(() => undefined);
  }, [dep]);
  return est;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function SettingsView() {
  const s = useStore();
  const { cases, images, lastBackup, syncConfig, syncState, syncing } = s;
  const [pendingImport, setPendingImport] = useState<BackupFile | null>(null);
  const [erase, setErase] = useState(false);
  const [url, setUrl] = useState(syncConfig.url);
  const [token, setToken] = useState(syncConfig.token);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const est = useStorageEstimate(cases.length + images.length);

  useEffect(() => {
    setUrl(syncConfig.url);
    setToken(syncConfig.token);
  }, [syncConfig.url, syncConfig.token]);

  const exportJson = async () => {
    const all = await s.exportAll();
    const b = buildBackup(all.cases, all.images);
    downloadBlob(new Blob([JSON.stringify(b)], { type: 'application/json' }), `ep-caselog-backup-${todayISO()}.json`);
    await s.markBackedUp();
    s.toast({ message: 'Backup downloaded', kind: 'success' });
  };

  const exportCsv = () => {
    downloadBlob(new Blob([casesToCsv(cases)], { type: 'text/csv;charset=utf-8' }), `ep-caselog-${todayISO()}.csv`);
  };

  const onImportFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      setPendingImport(parseBackup(await f.text()));
    } catch (e) {
      s.toast({ message: (e as Error).message, kind: 'error' });
    }
  };

  const saveSync = async () => {
    const u = url.trim();
    if (u && !/^https?:\/\/[^\s/]+/i.test(u)) {
      setUrlError('Enter a full URL, e.g. http://192.168.1.20:8787');
      return;
    }
    setUrlError(null);
    await s.saveSyncConfig({ ...syncConfig, url: u, token: token.trim() });
    s.toast({ message: u ? 'Sync settings saved' : 'Sync turned off', kind: 'success' });
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await pingServer({ url: url.trim(), token: token.trim(), auto: false });
      s.toast({ message: `Connected · server holds ${r.records} records`, kind: 'success' });
    } catch (e) {
      s.toast({ message: (e as Error).message, kind: 'error' });
    } finally {
      setTesting(false);
    }
  };

  const daysSinceBackup = lastBackup ? Math.floor((Date.now() - lastBackup) / 86_400_000) : null;

  return (
    <section className="view" aria-label="Settings">
      <h1 className="large-title">Settings</h1>

      <h2 className="section-label">Backup &amp; export</h2>
      <div className="card list">
        <div className="row">
          <div className="row-main">
            <b>Last backup</b>
            <div className={`small ${daysSinceBackup === null || daysSinceBackup > 14 ? 'warn-text' : 'muted'}`} data-testid="last-backup">
              {lastBackup ? `${fmtDateTime(lastBackup)}${daysSinceBackup! > 14 ? ' — consider a new backup' : ''}` : 'Never'}
            </div>
          </div>
        </div>
        <button className="row add-row" onClick={exportJson}>
          <Icon name="download" size={20} /> Download full backup (.json, includes images)
        </button>
        <button className="row add-row" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={20} /> Restore / merge from backup
        </button>
        <button className="row add-row" onClick={exportCsv} disabled={!cases.length}>
          <Icon name="doc" size={20} /> Export case log (.csv)
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden data-testid="import-input" onChange={(e) => (onImportFile(e.target.files?.[0]), (e.target.value = ''))} />
      </div>

      <h2 className="section-label">Sync</h2>
      <div className="card form-card">
        <p className="muted small">
          Optional. Point every device at the same self-hosted sync server (included with this app) to keep them in step. Without a server, everything stays on this device.
        </p>
        <label className="field">
          <span>Server URL</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.20:8787" inputMode="url" autoComplete="off" aria-invalid={!!urlError} />
          {urlError && (
            <span className="field-error" role="alert">
              {urlError}
            </span>
          )}
        </label>
        <label className="field">
          <span>Access token</span>
          <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" placeholder="Same value as SYNC_TOKEN on the server" />
        </label>
        <label className="field inline">
          <span>Sync automatically</span>
          <span className="switch">
            <input type="checkbox" checked={syncConfig.auto} onChange={(e) => s.saveSyncConfig({ ...syncConfig, auto: e.target.checked })} aria-label="Sync automatically" />
            <span className="switch-ui" />
          </span>
        </label>
        <div className="tool-row">
          <button className="btn primary" onClick={saveSync}>
            Save
          </button>
          <button className="btn" onClick={test} disabled={!url.trim() || testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <button className="btn" onClick={() => s.runSync(true)} disabled={!syncConfig.url || syncing}>
            <Icon name="refresh" size={18} /> {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
        <p className="small muted" data-testid="sync-status">
          {!syncConfig.url
            ? 'Sync is off.'
            : syncState.lastError
              ? `Last attempt failed: ${syncState.lastError}. Changes are kept on this device and will be sent later.`
              : syncState.lastSyncAt
                ? `Last synced ${fmtDateTime(syncState.lastSyncAt)}.`
                : 'Not synced yet.'}
        </p>
      </div>

      <h2 className="section-label">Storage</h2>
      <div className="card list">
        <div className="row">
          <div className="row-main">
            <b>On this device</b>
            <div className="muted small">
              {cases.length} cases · {images.length} images
              {est && ` · ${mb(est.usage)} used of ${mb(est.quota)} available`}
            </div>
            <div className="muted small">
              {est?.persisted ? 'Persistent storage granted — the browser will not evict this data automatically.' : 'Storage is "best effort": the browser may clear it under disk pressure. Keep regular backups.'}
            </div>
          </div>
        </div>
        <button className="row add-row danger-text" onClick={() => setErase(true)}>
          <Icon name="trash" size={20} /> Erase all data on this device
        </button>
      </div>

      <h2 className="section-label">About</h2>
      <div className="card pad about">
        <p>
          <b>EP Case Log</b> 1.0 — an offline-first personal logbook for electrophysiology procedures: ablations, device implants, extractions, LAA closure and EP studies.
        </p>
        <p className="muted small">
          Independent project; not affiliated with any other case-logging app. Not a medical record and not a decision-support tool. CHA₂DS₂-VASc / CHA₂DS₂-VA scores are computed from what you enter, for logging only.
        </p>
        <p className="muted small">Data is stored in this browser's IndexedDB. Nothing leaves the device unless you configure a sync server or download a file.</p>
      </div>

      {pendingImport && (
        <Confirm
          title="Restore from backup?"
          danger={false}
          message={
            <>
              Backup from {new Date(pendingImport.exportedAt).toLocaleString()} with {pendingImport.cases.filter((c) => !c.deleted).length} cases and {pendingImport.images.filter((i) => !i.deleted).length} images. Records are
              merged: the newer version of each record is kept; nothing newer on this device is overwritten.
            </>
          }
          confirmLabel="Merge backup"
          onCancel={() => setPendingImport(null)}
          onConfirm={async () => {
            const b = pendingImport;
            setPendingImport(null);
            try {
              const r = await s.importRecords(b.cases, b.images);
              s.toast({ message: `Imported ${r.cases} case and ${r.images} image updates`, kind: 'success' });
            } catch (e) {
              s.toast({ message: `Import failed: ${(e as Error).message}`, kind: 'error' });
            }
          }}
        />
      )}
      {erase && (
        <Confirm
          title="Erase all data?"
          message={
            <>
              This permanently removes {cases.length} cases and {images.length} images from this device. It cannot be undone.
              {syncConfig.url ? ' Data already on the sync server is not deleted and will download again on the next sync.' : ''} Download a backup first if unsure.
            </>
          }
          confirmLabel="Erase everything"
          typeToConfirm="ERASE"
          onCancel={() => setErase(false)}
          onConfirm={async () => {
            setErase(false);
            await s.eraseAll();
            s.toast({ message: 'All local data erased', kind: 'success' });
          }}
        />
      )}
    </section>
  );
}
