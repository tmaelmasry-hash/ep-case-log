import { useState } from 'react';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { Icon } from '../components/Icon';
import { AccountSection, UsersSection } from './AccountSettings';
import { ActivitySheet, GroupsSheet, RecycleBinSheet, useRecycleBin } from './AdminSheets';

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

export function SettingsView() {
  const { can } = useAuth();
  return (
    <section className="view" aria-label="Settings">
      <h1 className="large-title">Settings</h1>
      <AccountSection />
      {can('groups.manage') && <AdminSection />}
      {can('users.manage') && <UsersSection />}
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
