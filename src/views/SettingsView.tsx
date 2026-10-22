import { useState } from 'react';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { Icon } from '../components/Icon';
import { AccountSection, UsersSection } from './AccountSettings';
import { ActivitySheet, GroupsSheet, RecycleBinSheet, useRecycleBin } from './AdminSheets';
import { api, ApiError } from '../lib/api';

/** Admin rows (approved phase 3 preview): groups, recycle bin, activity log — each opens in a sheet. */
function AdminSection() {
  const { groups } = useStore();
  const bin = useRecycleBin(true);
  const [open, setOpen] = useState<'groups' | 'bin' | 'activity' | null>(null);
  const row = (key: typeof open, icon: string, text: string, count?: number) => (
    <button className="grow-row" onClick={() => setOpen(key)} data-testid={`admin-${key}`}>
      <span className="row-ic">
        <Icon name={icon} size={22} />
      </span>
      <span className="grow">{text}</span>
      {count !== undefined && <span className="muted small">{count}</span>}
      <Icon name="chevron" size={16} className="muted" />
    </button>
  );
  return (
    <>
      <h2 className="section-label">Admin</h2>
      <div className="group">
        {row('groups', 'list', 'Groups', groups.length)}
        {row('bin', 'trash', 'Recycle bin', bin.rows?.length)}
        {row('activity', 'doc', 'Activity log')}
      </div>
      {open === 'groups' && <GroupsSheet onClose={() => setOpen(null)} />}
      {open === 'bin' && <RecycleBinSheet onClose={() => setOpen(null)} onChanged={bin.load} />}
      {open === 'activity' && <ActivitySheet onClose={() => setOpen(null)} />}
    </>
  );
}

/** Excel export (phase 10): the whole registry (Admin) or one of the user's groups. Downloaded, never kept. */
function ExportSection() {
  const { can } = useAuth();
  const { groups, toast } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    try {
      const f = await api<{ file_name: string; base64: string; cases: number }>('POST', '/api/exports', body);
      const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = f.file_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast({ message: `Downloaded ${f.file_name}`, kind: 'success' });
    } catch (e) {
      toast({ message: (e as ApiError).message, kind: 'error' });
    } finally {
      setBusy(null);
    }
  };
  if (!can('export.group')) return null;
  return (
    <>
      <h2 className="section-label">Export to Excel</h2>
      <div className="group" data-testid="export-section">
        {can('export.all') && (
          <button className="grow-row" disabled={!!busy} onClick={() => run('ALL', { scope: 'ALL' })} data-testid="export-all">
            <span className="row-ic">
              <Icon name="download" size={22} />
            </span>
            <span className="grow">Whole registry</span>
            <span className="muted small">{busy === 'ALL' ? 'Preparing…' : 'All tabs'}</span>
          </button>
        )}
        {groups.map((g) => (
          <button key={g.group_id} className="grow-row" disabled={!!busy} onClick={() => run(g.group_id, { scope: 'GROUP', group_id: g.group_id })} data-testid="export-group">
            <span className="row-ic">
              <Icon name="download" size={22} />
            </span>
            <span className="grow">{g.name}</span>
            <span className="muted small">{busy === g.group_id ? 'Preparing…' : `${g.cases ?? 0} cases`}</span>
          </button>
        ))}
      </div>
      <p className="note">The same tabs and columns as the registry Google Sheet. Passwords are never in the file. A group file holds that group's cases only.</p>
    </>
  );
}

export function SettingsView() {
  const { can } = useAuth();
  return (
    <section className="view" aria-label="Settings">
      <h1 className="large-title">Settings</h1>
      <AccountSection />
      {can('groups.manage') && <AdminSection />}
      {can('users.manage') && <UsersSection />}
      <ExportSection />
      <h2 className="section-label">About</h2>
      <div className="card pad about">
        <p>
          <b>EP Case Log</b> — electrophysiology registry. Clinical fields and codes come only from the registry dictionary.
        </p>
        <p className="muted small">Cases are kept on the registry server. Not a medical record and not a decision-support tool.</p>
      </div>
    </section>
  );
}
