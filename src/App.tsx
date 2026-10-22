import { useStore } from './store';
import { useAuth } from './auth';
import { Icon } from './components/Icon';
import { SaveIndicator, Toasts, useHashRoute, useMediaQuery } from './components/ui';
import { CasesView } from './views/CasesView';
import { CaseDetail } from './views/CaseDetail';
import { PatientsView } from './views/PatientsView';
import { StatsView } from './views/StatsView';
import { SettingsView } from './views/SettingsView';
import { InboxView } from './views/InboxView';

const TABS = [
  { key: 'cases', label: 'Cases', icon: 'cases' },
  { key: 'patients', label: 'Patients', icon: 'patients' },
  { key: 'stats', label: 'Stats', icon: 'stats' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

export function App() {
  const { loaded, fatal, images } = useStore();
  const { me } = useAuth();
  const [route, nav] = useHashRoute();
  const wide = useMediaQuery('(min-width: 960px)');
  const tab = route[0];
  const inboxCount = images.filter((i) => i.caseId === null).length;

  if (fatal) {
    return (
      <div className="fatal">
        <Icon name="alert" size={32} />
        <h1>Storage unavailable</h1>
        <p>{fatal}</p>
        <p>This app stores data in your browser (IndexedDB). Private-browsing modes or blocked site data can prevent this.</p>
        <button className="btn primary" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="loading" aria-busy="true">
        <div className="spinner" />
        <span>Loading your case log…</span>
      </div>
    );
  }

  let main;
  if (tab === 'cases' || tab === 'inbox') {
    const caseId = tab === 'cases' ? route[1] : undefined;
    if (wide) {
      main = (
        <div className="split">
          <div className="split-list">
            <CasesView selectedId={caseId} nav={nav} inboxCount={inboxCount} />
          </div>
          <div className="split-detail">
            {tab === 'inbox' ? <InboxView nav={nav} /> : caseId ? <CaseDetail id={caseId} nav={nav} /> : <div className="placeholder">Select a case or press + to log a new one.</div>}
          </div>
        </div>
      );
    } else if (tab === 'inbox') main = <InboxView nav={nav} />;
    else main = caseId ? <CaseDetail id={caseId} nav={nav} /> : <CasesView nav={nav} inboxCount={inboxCount} />;
  } else if (tab === 'patients') main = <PatientsView mrn={route[1]} nav={nav} />;
  else if (tab === 'stats') main = <StatsView />;
  else if (tab === 'settings') main = <SettingsView />;
  else main = <CasesView nav={nav} inboxCount={inboxCount} />;

  const activeTab = tab === 'inbox' ? 'cases' : tab;
  let embedded = false;
  try {
    embedded = window.self !== window.top;
  } catch {
    embedded = true;
  }

  return (
    <div className={`app ${wide ? 'is-wide' : 'is-narrow'}`}>
      <nav className="tabbar" aria-label="Main">
        {wide && (
          <div className="brand">
            <span className="brand-mark" aria-hidden>
              <Icon name="spike" size={22} />
            </span>
            <span>EP Case Log</span>
          </div>
        )}
        {TABS.map((t) => (
          <a key={t.key} href={`#/${t.key}`} className={activeTab === t.key ? 'active' : ''} aria-current={activeTab === t.key ? 'page' : undefined}>
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </a>
        ))}
        {wide && (
          <div className="tabbar-foot">
            <SaveIndicator />
            {me && (
              <div className="muted small" data-testid="sidebar-user">
                {me.name} · {me.role === 'ADMIN' ? 'Admin' : 'Member'}
              </div>
            )}
          </div>
        )}
      </nav>
      {embedded && (
        <div className="preview-banner" role="note">
          Preview: data stays in this browser only. PDF export, file downloads, camera capture and offline install need the self-hosted version.
        </div>
      )}
      <main className="main">{main}</main>
      <Toasts />
    </div>
  );
}
