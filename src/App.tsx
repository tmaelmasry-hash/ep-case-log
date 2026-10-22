import { useStore } from './store';
import { useAuth } from './auth';
import { Icon } from './components/Icon';
import { SaveIndicator, Toasts, useHashRoute, useMediaQuery } from './components/ui';
import { CasesView } from './views/CasesView';
import { CaseView } from './views/CaseView';
import { PatientsView } from './views/PatientsView';
import { StatsView } from './views/StatsView';
import { SettingsView } from './views/SettingsView';

const TABS = [
  { key: 'cases', label: 'Cases', icon: 'cases' },
  { key: 'patients', label: 'Patients', icon: 'patients' },
  { key: 'stats', label: 'Dashboard', icon: 'stats' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

export function App() {
  const { loaded } = useStore();
  const { me } = useAuth();
  const [route, nav] = useHashRoute();
  const wide = useMediaQuery('(min-width: 960px)');
  const tab = route[0];

  if (!loaded) {
    return (
      <div className="loading" aria-busy="true">
        <div className="spinner" />
        <span>Loading cases…</span>
      </div>
    );
  }

  let main;
  if (tab === 'cases' || !TABS.some((t) => t.key === tab)) {
    const caseId = tab === 'cases' ? route[1] : undefined;
    if (wide) {
      main = (
        <div className="split">
          <div className="split-list">
            <CasesView selectedId={caseId} nav={nav} />
          </div>
          <div className="split-detail">{caseId ? <CaseView key={caseId} id={caseId} nav={nav} wide /> : <div className="placeholder">Select a case, or press + to create one.</div>}</div>
        </div>
      );
    } else main = caseId ? <CaseView key={caseId} id={caseId} nav={nav} wide={false} /> : <CasesView nav={nav} />;
  } else if (tab === 'patients') main = <PatientsView mrn={route[1]} nav={nav} />;
  else if (tab === 'stats') main = <StatsView />;
  else main = <SettingsView />;

  const activeTab = TABS.some((t) => t.key === tab) ? tab : 'cases';

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
      <main className="main">{main}</main>
      <Toasts />
    </div>
  );
}
