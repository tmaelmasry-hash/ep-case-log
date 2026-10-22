import { useAuth } from '../auth';
import { AccountSection, UsersSection } from './AccountSettings';

export function SettingsView() {
  const { can } = useAuth();
  return (
    <section className="view" aria-label="Settings">
      <h1 className="large-title">Settings</h1>
      <AccountSection />
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
