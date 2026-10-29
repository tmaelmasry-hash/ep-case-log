import { useEffect, useState } from 'react';
import { useOnline } from '../lib/sync';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { Icon } from '../components/Icon';
import { AccountSection, UsersSection } from './AccountSettings';
import { ActivitySheet, GroupsSheet, RecycleBinSheet, useRecycleBin } from './AdminSheets';
import { api, ApiError } from '../lib/api';
import { downloadXlsx } from '../lib/exportFile';
import { getDefaultGroup, setDefaultGroup, setTextSize, setTheme, usePrefs, type TextSize, type Theme } from '../lib/prefs';

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
      toast({ message: `Downloaded ${await downloadXlsx(body)}`, kind: 'success' });
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

interface AiStatus {
  provider: string;
  label: string;
  model: string | null;
  configured: boolean;
  reason: string | null;
  usage: { month: string; runs: number; cost_usd: number };
  monthly_cost_cap_usd: number | null;
  providers: { id: string; model: string | null; key_set: boolean | null }[];
}

const PROVIDER_LABEL: Record<string, string> = { fixture: 'Test AI (sample notes only)', anthropic: 'Claude (Anthropic)', gemini: 'Gemini (Google)', openai: 'OpenAI', off: 'Off' };

/** Admin: which AI provider the AI Assistant uses. Keys live only in the server's secrets, never here. */
function AiSection() {
  const { toast } = useStore();
  const [st, setSt] = useState<AiStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    api<AiStatus>('GET', '/api/ai/status')
      .then(setSt)
      .catch((e) => toast({ message: (e as Error).message, kind: 'error' }));
  useEffect(() => {
    load();
  }, []);
  if (!st) return null;
  const choose = async (provider: string) => {
    setBusy(true);
    try {
      const r = await api<{ label: string; configured: boolean; reason: string | null }>('POST', '/api/settings/ai', { provider });
      toast({ message: r.configured ? `AI provider: ${r.label}` : `${r.label}: ${r.reason ?? 'not ready'}`, kind: r.configured ? 'success' : 'error' });
      await load();
    } catch (e) {
      toast({ message: (e as ApiError).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h2 className="section-label">AI provider</h2>
      <div className="group" data-testid="ai-settings">
        {st.providers.map((p) => (
          <label key={p.id} className="grow-row">
            <input type="radio" name="ai-provider" checked={st.provider === p.id} disabled={busy} onChange={() => choose(p.id)} />
            <span className="grow">
              <span className="line1">{PROVIDER_LABEL[p.id] ?? p.id}</span>
              <span className="sub">
                {p.model ? `${p.model} · ` : ''}
                {p.key_set === null ? 'no key needed' : p.key_set ? 'key set' : 'key not set'}
              </span>
            </span>
          </label>
        ))}
      </div>
      <p className="note">
        {st.configured ? `In use: ${st.label}.` : `Not ready: ${st.reason ?? ''}`} This month: {st.usage.runs} run{st.usage.runs === 1 ? '' : 's'}, US$ {st.usage.cost_usd.toFixed(2)}
        {st.monthly_cost_cap_usd ? ` of US$ ${st.monthly_cost_cap_usd}` : ''}. API keys are set on the server (secrets), never in this app.
      </p>
    </>
  );
}

/** Look and defaults on this device (owner, step 6): Light / Dark / Auto, text size, default group. */
function AppearanceSection() {
  const { me } = useAuth();
  const { groups } = useStore();
  const { theme, size } = usePrefs();
  const [def, setDef] = useState(() => getDefaultGroup(me?.id) ?? '');
  const THEMES: [Theme, string][] = [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']];
  const SIZES: [TextSize, string][] = [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large'], ['larger', 'Larger']];
  return (
    <>
      <h2 className="section-label">Appearance · this device</h2>
      <div className="card pad prefs" data-testid="appearance">
        <div className="pref">
          <span>Theme</span>
          <div className="seg" role="radiogroup" aria-label="Theme">
            {THEMES.map(([k, t]) => (
              <button key={k} type="button" role="radio" aria-checked={theme === k} className={theme === k ? 'on' : ''} onClick={() => setTheme(k)}>
                {t}
              </button>
            ))}
          </div>
          <span className="muted small">Auto follows the phone or computer setting.</span>
        </div>
        <div className="pref">
          <span>Text size</span>
          <div className="seg" role="radiogroup" aria-label="Text size">
            {SIZES.map(([k, t]) => (
              <button key={k} type="button" role="radio" aria-checked={size === k} className={`${size === k ? 'on' : ''} ts-${k}`} onClick={() => setTextSize(k)}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
      {groups.length > 1 && me && (
        <>
          <h2 className="section-label">Cases</h2>
          <div className="card list">
            <label className="row">
              <span className="row-main">Default group</span>
              <select
                className="pref-select"
                value={def}
                aria-label="Default group"
                data-testid="default-group"
                onChange={(e) => {
                  setDef(e.target.value);
                  setDefaultGroup(me.id, e.target.value || null);
                }}
              >
                <option value="">First group</option>
                {groups.map((g) => (
                  <option key={g.group_id} value={g.group_id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="note">New case and Bulk add start on this group.</p>
        </>
      )}
    </>
  );
}

/** Admin AI section with the show / hide switch (owner, step 6). */
function AiVisibility() {
  const { me, retry: reloadMe } = useAuth();
  const { toast } = useStore();
  const on = me?.features?.ai !== false;
  const [busy, setBusy] = useState(false);
  const flip = async () => {
    setBusy(true);
    try {
      await api('POST', '/api/settings/ui', { ai_visible: !on });
      await reloadMe();
      toast({ message: on ? 'AI Assistant hidden' : 'AI Assistant shown', kind: 'success' });
    } catch (e) {
      toast({ message: (e as ApiError).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h2 className="section-label">AI Assistant</h2>
      <div className="card list">
        <label className="row switch-row">
          <span className="row-main">
            Show the AI Assistant
            <span className="muted small block">Off: the AI icon is hidden in every case.</span>
          </span>
          <span className="switch">
            <input type="checkbox" role="switch" checked={on} disabled={busy} onChange={flip} aria-label="Show the AI Assistant" data-testid="ai-visible" />
            <span className="switch-ui" />
          </span>
        </label>
      </div>
      {on && <AiSection />}
    </>
  );
}

/** Admin page (owner, step 6): its own page, opened from Settings. */
export function AdminView() {
  const { can } = useAuth();
  const online = useOnline();
  if (!can('users.manage'))
    return (
      <section className="view">
        <p className="muted">Admin only.</p>
      </section>
    );
  return (
    <section className="view" aria-label="Admin" data-testid="admin-view">
      <div className="navbar">
        <a href="#/settings" className="back link">
          <Icon name="back" size={22} /> Settings
        </a>
      </div>
      <h1 className="large-title">Admin</h1>
      {!online && <p className="note">No connection: Users, Groups, Recycle bin, Activity log and AI need the connection.</p>}
      <div className={online ? undefined : 'needs-net'} aria-disabled={!online || undefined}>
        <UsersSection />
        {can('groups.manage') && <AdminSection />}
        {can('settings.manage') && <AiVisibility />}
      </div>
    </section>
  );
}

export function SettingsView() {
  const { can } = useAuth();
  const online = useOnline();
  return (
    <section className="view" aria-label="Settings">
      <h1 className="large-title">Settings</h1>
      <AccountSection />
      <AppearanceSection />
      {can('users.manage') && (
        <a className="card admin-link" href="#/admin" data-testid="admin-link">
          <span className="admin-ic" aria-hidden>
            <Icon name="user" size={20} />
          </span>
          <span className="grow">
            <b>Admin</b>
            <span className="muted small block">Users, groups, recycle bin, activity log, AI</span>
          </span>
          <Icon name="chevron" size={16} className="muted" />
        </a>
      )}
      {!online && (
        <p className="note" data-testid="settings-offline">
          No connection: Excel export needs the connection.
        </p>
      )}
      <div className={online ? undefined : 'needs-net'} aria-disabled={!online || undefined}>
        <ExportSection />
      </div>
      <h2 className="section-label">About</h2>
      <div className="card pad about">
        <p>
          <b>KAMC EP Registry</b> — electrophysiology registry. Clinical fields and codes come only from the registry dictionary.
        </p>
        <p className="muted small">Cases are kept in the registry's Google Sheet; this device keeps a copy of the cases opened here and the changes not sent yet. Not a medical record and not a decision-support tool.</p>
      </div>
    </section>
  );
}
