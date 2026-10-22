import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { buildBackup, casesToCsv, parseBackup } from '../lib/backup';
import type { BackupFile } from '../lib/types';
import { downloadBlob, fmtDateTime, todayISO } from '../lib/util';
import { Icon } from '../components/Icon';
import { Confirm } from '../components/ui';
import { useAuth } from '../auth';
import { AccountSection, UsersSection } from './AccountSettings';

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
  const { can } = useAuth();
  const { cases, images, lastBackup } = s;
  const [pendingImport, setPendingImport] = useState<BackupFile | null>(null);
  const [erase, setErase] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const est = useStorageEstimate(cases.length + images.length);

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

  const daysSinceBackup = lastBackup ? Math.floor((Date.now() - lastBackup) / 86_400_000) : null;

  return (
    <section className="view" aria-label="Settings">
      <h1 className="large-title">Settings</h1>
      <AccountSection />
      {can('users.manage') && <UsersSection />}

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
        <p className="muted small">Data is stored in this browser's IndexedDB. Cases stay on this device until the registry store arrives in the next phases. Sign-in and accounts are on the registry server.</p>
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
              {' '}Download a backup first if unsure.
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
