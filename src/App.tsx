import { useState } from 'react';
import { useStore } from './store';
import { useAuth } from './auth';
import { Icon } from './components/Icon';
import { SaveIndicator, Toasts, useHashRoute, useMediaQuery } from './components/ui';
import { CategoryTree } from './components/CategoryTree';
import { PeriodSheet } from './components/PeriodSheet';
import { CasesView } from './views/CasesView';
import { CaseView } from './views/CaseView';
import { PatientView } from './views/PatientsView';
import { StatsView } from './views/StatsView';
import { AdminView, SettingsView } from './views/SettingsView';
import { MyWorkView } from './views/MyWorkView';
import { CompletenessView } from './views/CompletenessView';
import { FollowupView, useFollowups } from './views/Followups';
import { EmptyPane } from './views/EmptyPane';
import { useOnline } from './lib/sync';
import { UserLink } from './components/UserLink';

export function App() {
  const { loaded, cases } = useStore();
  const { me, can } = useAuth();
  const [route, nav] = useHashRoute();
  const wide = useMediaQuery('(min-width: 960px)');
  const [period, setPeriod] = useState(false);
  const online = useOnline();
  const fu = useFollowups(!!me?.features?.followups);
  // Owner, step 5: My work first; Follow-up tab; no Patients tab (the patient page opens from an MRN); Dashboard for the Admin.
  const TABS = [
    { key: 'mywork', label: 'My work', icon: 'clipboard' },
    { key: 'cases', label: 'Cases', icon: 'cases' },
    ...(me?.features?.followups ? [{ key: 'followup', label: 'Follow-up', icon: 'cal', badge: fu.urgent }] : []),
    ...(can('dashboard.view') ? [{ key: 'stats', label: 'Dashboard', icon: 'stats' }] : []),
    { key: 'settings', label: 'Settings', icon: 'settings' },
  ];
  const tab = route[0] === 'patients' || route[0] === 'admin' || route[0] === 'completeness' || TABS.some((t) => t.key === route[0]) ? route[0] : 'mywork';

  if (!loaded) {
    return (
      <div className="loading" aria-busy="true">
        <div className="spinner" />
        <span>Loading procedures…</span>
      </div>
    );
  }

  let main;
  if (tab === 'cases') {
    const caseId = route[1];
    if (wide) {
      main = (
        <div className="split">
          <div className="split-list">
            <CasesView selectedId={caseId} nav={nav} />
          </div>
          <div className="split-detail">{caseId ? <CaseView key={caseId} id={caseId} nav={nav} wide /> : <EmptyPane fu={fu} nav={nav} />}</div>
        </div>
      );
    } else main = caseId ? <CaseView key={caseId} id={caseId} nav={nav} wide={false} /> : <CasesView nav={nav} />;
  } else if (tab === 'patients') main = <PatientView mrn={route[1] ?? ''} />;
  else if (tab === 'mywork') main = <MyWorkView />;
  else if (tab === 'followup') main = <FollowupView fu={fu} />;
  else if (tab === 'stats') main = <StatsView />;
  else if (tab === 'admin') main = <AdminView />;
  else if (tab === 'completeness') main = <CompletenessView />;
  else main = <SettingsView />;

  const activeTab = tab === 'patients' ? 'cases' : tab === 'admin' || tab === 'completeness' ? 'settings' : tab;

  return (
    <div className={`app ${wide ? 'is-wide' : 'is-narrow'}`}>
      <nav className="tabbar" aria-label="Main">
        {wide && (
          <div className="brand">
            <span className="brand-mark" aria-hidden>
              <Icon name="spike" size={22} />
            </span>
            <span>KAMC EP Registry</span>
          </div>
        )}
        {TABS.map((t) => (
          <a key={t.key} href={`#/${t.key}`} className={activeTab === t.key ? 'active' : ''} aria-current={activeTab === t.key ? 'page' : undefined} data-testid={`tab-${t.key}`}>
            <span className="tab-ic">
              <Icon name={t.icon} size={22} />
              {'badge' in t && t.badge ? (
                <span className="badge" aria-label={`${t.badge} due within 7 days or overdue`}>
                  {t.badge}
                </span>
              ) : null}
            </span>
            <span>{t.label}</span>
          </a>
        ))}
        {wide && (
          <div className="side-cats" onClickCapture={(e) => (e.target as HTMLElement).closest('.cat-name, .cat-period .pill') && activeTab !== 'cases' && nav('cases')}>
            <CategoryTree cases={cases} onCustomPeriod={() => setPeriod(true)} />
          </div>
        )}
        {wide && (
          <div className="tabbar-foot">
            <SaveIndicator />
            {me && <UserLink />}
          </div>
        )}
      </nav>
      <main className="main">
        {!online && (
          <div className="offline-bar" role="status" data-testid="offline-bar">
            ● Offline — working from this device. Changes are sent when the connection is back.
          </div>
        )}
        {main}
      </main>
      {period && <PeriodSheet onClose={() => setPeriod(false)} />}
      <Toasts />
    </div>
  );
}
