import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { sync, useOnline } from '../lib/sync';
import { useAuth } from '../auth';
import { api, ApiError } from '../lib/api';
import { fmtDateTime } from '../lib/util';
import { useStore } from '../store';
import { Icon } from '../components/Icon';
import { ChipSelect, Confirm, Segmented, Sheet } from '../components/ui';
import { PasswordForm } from './SignIn';

interface UserRow {
  user_id: string;
  username: string;
  display_name: string;
  role: 'ADMIN' | 'MEMBER';
  status: 'ACTIVE' | 'DISABLED';
  groups: string[];
  must_change_password: boolean;
  locked: boolean;
  last_login_at: string | null;
}
interface GroupRow {
  group_id: string;
  name: string;
}
interface Credentials {
  username: string;
  password: string | null;
  must_change_password: boolean;
  app_url: string;
}

const roleLabel = (r: string) => (r === 'ADMIN' ? 'Admin' : 'Member');

export function AccountSection() {
  const { me, signOut, changePassword } = useAuth();
  const online = useOnline();
  const waiting = useSyncExternalStore(sync.subscribe, sync.getState).waiting;
  const { toast } = useStore();
  const [pwSheet, setPwSheet] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  if (!me) return null;
  return (
    <>
      <h2 className="section-label">My account</h2>
      <div className="card list">
        <div className="row">
          <div className="row-main">
            <b data-testid="me-name">{me.name}</b>
            <div className="muted small">
              @{me.username} · {roleLabel(me.role)}
            </div>
          </div>
        </div>
        <button className="row add-row" onClick={() => setPwSheet(true)} disabled={!online}>
          <Icon name="edit" size={20} /> Change password
        </button>
        {/* L3: signing out without connection while changes wait would leave them unsent. */}
        <button className="row add-row danger-text" onClick={() => setConfirmOut(true)} disabled={!online && waiting > 0} data-testid="sign-out">
          <Icon name="back" size={20} /> Sign out
        </button>
        {!online && waiting > 0 && <p className="note">Sign out is possible once the {waiting} waiting change{waiting === 1 ? ' is' : 's are'} sent.</p>}
      </div>
      {pwSheet && (
        <Sheet title="Change Password" onClose={() => setPwSheet(false)}>
          <p className="muted small">Your other devices will be signed out.</p>
          <PasswordForm
            submitLabel="Save new password"
            onSubmit={async (cur, next) => {
              await changePassword(cur, next);
              setPwSheet(false);
              toast({ message: 'Password changed', kind: 'success' });
            }}
          />
        </Sheet>
      )}
      {confirmOut && (
        <Confirm title="Sign out?" message="You will need your username and password to sign in again on this device." confirmLabel="Sign out" danger={false} onCancel={() => setConfirmOut(false)} onConfirm={signOut} />
      )}
    </>
  );
}

function CredentialsSheet({ creds, onClose }: { creds: Credentials; onClose: () => void }) {
  const text = [`KAMC EP Registry: ${creds.app_url}`, `Username: ${creds.username}`, creds.password ? `Password: ${creds.password}` : 'Password: the one you were given', creds.must_change_password ? 'You will choose your own password at first sign-in.' : ''].filter(Boolean).join('\n');
  const [copied, setCopied] = useState(false);
  return (
    <Sheet title="Send to the User" onClose={onClose} onDone={onClose} testId="credentials-sheet">
      <p className="muted small">Send these details to the user privately. {creds.password ? 'The password is shown only now.' : ''}</p>
      <pre className="cred-box" data-testid="credentials-text">{text}</pre>
      <button
        className="btn primary block"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </Sheet>
  );
}

function AddUserSheet({ groups, onClose, onCreated }: { groups: GroupRow[]; onClose: () => void; onCreated: (c: Credentials) => void }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('Member');
  const [selGroups, setSelGroups] = useState<string[]>(groups.length ? [groups[0].name] : []);
  const [ownPw, setOwnPw] = useState(false);
  const [password, setPassword] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<Credentials>('POST', '/api/admin/users', {
        name,
        username,
        role: role === 'Admin' ? 'ADMIN' : 'MEMBER',
        groups: groups.filter((g) => selGroups.includes(g.name)).map((g) => g.group_id),
        password: ownPw ? password : undefined,
        must_change_password: mustChange,
      });
      onCreated(r);
    } catch (e) {
      const a = e as ApiError;
      setErr({ field: a.field, message: a.message });
      setBusy(false);
    }
  };
  const fieldErr = (f: string) => (err?.field === f ? <span className="field-error" role="alert">{err.message}</span> : null);

  return (
    <Sheet title="Add User" onClose={onClose} onDone={submit} doneLabel="Add" doneDisabled={busy} testId="add-user-sheet">
      <div className="card form-card">
        <label className="field">
          <span>Display name</span>
          <input id="new-user-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dr. Sara K." autoFocus />
          {fieldErr('name')}
        </label>
        <label className="field">
          <span>Username</span>
          <input id="new-user-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. sara.k" autoCapitalize="none" spellCheck={false} />
          {fieldErr('username')}
        </label>
        <div className="field">
          <span>Role</span>
          <Segmented label="Role" options={['Member', 'Admin']} value={role} onChange={setRole} allowClear={false} />
          <span className="hint">{role === 'Admin' ? 'Admins also manage users, groups, settings, bulk add, restore, dashboard and full export.' : 'Members add and edit cases in their groups.'}</span>
        </div>
        <div className="field">
          <span>Groups</span>
          <ChipSelect label="Groups" options={groups.map((g) => g.name)} value={selGroups} onChange={setSelGroups} />
        </div>
        <label className="field inline">
          <span>Type my own password</span>
          <span className="switch">
            <input type="checkbox" checked={ownPw} onChange={(e) => setOwnPw(e.target.checked)} aria-label="Type my own password" />
            <span className="switch-ui" />
          </span>
        </label>
        {ownPw ? (
          <label className="field">
            <span>Password (10+ characters)</span>
            <input id="new-user-password" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            {fieldErr('password')}
          </label>
        ) : (
          <p className="hint">A one-time password will be generated and shown once.</p>
        )}
        <label className="field inline">
          <span>Must choose own password at first sign-in</span>
          <span className="switch">
            <input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} aria-label="Must choose own password at first sign-in" />
            <span className="switch-ui" />
          </span>
        </label>
      </div>
      {err && !err.field && (
        <p className="field-error" role="alert">
          {err.message}
        </p>
      )}
      <button className="btn primary block" onClick={submit} disabled={busy}>
        {busy ? 'Adding…' : 'Add user'}
      </button>
    </Sheet>
  );
}

function EditUserSheet({ user, groups, isSelf, onClose, onSaved, onCredentials }: { user: UserRow; groups: GroupRow[]; isSelf: boolean; onClose: () => void; onSaved: () => void; onCredentials: (c: Credentials) => void }) {
  const { toast } = useStore();
  const [name, setName] = useState(user.display_name);
  const [role, setRole] = useState(roleLabel(user.role));
  const [selGroups, setSelGroups] = useState(groups.filter((g) => user.groups.includes(g.group_id)).map((g) => g.name));
  const [confirm, setConfirm] = useState<null | 'disable' | 'enable' | 'password'>(null);
  const [err, setErr] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>, message: string) => {
    try {
      await api('PATCH', `/api/admin/users/${user.user_id}`, body);
      toast({ message, kind: 'success' });
      onSaved();
    } catch (e) {
      setErr((e as ApiError).message);
    }
  };

  const save = () =>
    patch(
      { name, role: role === 'Admin' ? 'ADMIN' : 'MEMBER', groups: groups.filter((g) => selGroups.includes(g.name)).map((g) => g.group_id) },
      'User saved',
    );

  return (
    <Sheet title={user.display_name} onClose={onClose} onDone={save} doneLabel="Save" testId="edit-user-sheet">
      <p className="muted small">
        @{user.username} · {user.last_login_at ? `last sign-in ${fmtDateTime(new Date(user.last_login_at).getTime())}` : 'never signed in'}
      </p>
      <div className="card form-card">
        <label className="field">
          <span>Display name</span>
          <input id="edit-user-name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field">
          <span>Role</span>
          {isSelf ? <span className="hint">You cannot change your own role.</span> : <Segmented label="Role" options={['Member', 'Admin']} value={role} onChange={setRole} allowClear={false} />}
        </div>
        <div className="field">
          <span>Groups</span>
          <ChipSelect label="Groups" options={groups.map((g) => g.name)} value={selGroups} onChange={setSelGroups} />
        </div>
      </div>
      {err && (
        <p className="field-error" role="alert">
          {err}
        </p>
      )}
      <button className="btn primary block" onClick={save}>
        Save changes
      </button>
      <div className="card list" style={{ marginTop: 16 }}>
        {user.locked && (
          <button className="row add-row" onClick={() => patch({ unlock: true }, 'Account unlocked')}>
            <Icon name="refresh" size={20} /> Unlock account
          </button>
        )}
        <button className="row add-row" onClick={() => setConfirm('password')}>
          <Icon name="edit" size={20} /> Set a new password
        </button>
        {!isSelf &&
          (user.status === 'ACTIVE' ? (
            <button className="row add-row danger-text" onClick={() => setConfirm('disable')}>
              <Icon name="close" size={20} /> Disable account
            </button>
          ) : (
            <button className="row add-row" onClick={() => setConfirm('enable')}>
              <Icon name="check" size={20} /> Enable account
            </button>
          ))}
      </div>
      {confirm === 'disable' && (
        <Confirm
          title="Disable this account?"
          message={`${user.display_name} will be signed out on every device and cannot sign in until enabled again. Nothing they entered is deleted.`}
          confirmLabel="Disable"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            patch({ status: 'DISABLED' }, 'Account disabled');
          }}
        />
      )}
      {confirm === 'enable' && (
        <Confirm title="Enable this account?" message={`${user.display_name} can sign in again.`} confirmLabel="Enable" danger={false} onCancel={() => setConfirm(null)} onConfirm={() => (setConfirm(null), patch({ status: 'ACTIVE' }, 'Account enabled'))} />
      )}
      {confirm === 'password' && (
        <Confirm
          title="Set a new password?"
          message={`A one-time password will be generated. ${user.display_name} will be signed out everywhere and must choose their own password at the next sign-in.`}
          confirmLabel="Generate password"
          danger={false}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null);
            try {
              onCredentials(await api<Credentials>('POST', `/api/admin/users/${user.user_id}/password`, { must_change_password: true }));
            } catch (e) {
              setErr((e as ApiError).message);
            }
          }}
        />
      )}
    </Sheet>
  );
}

export function UsersSection() {
  const { me } = useAuth();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [creds, setCreds] = useState<Credentials | null>(null);

  const load = useCallback(async () => {
    try {
      const [u, g] = await Promise.all([api<{ users: UserRow[] }>('GET', '/api/admin/users'), api<{ groups: GroupRow[] }>('GET', '/api/groups')]);
      setUsers(u.users);
      setGroups(g.groups);
      setError(null);
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const gname = (id: string) => groups.find((g) => g.group_id === id)?.name ?? '';

  return (
    <>
      <h2 className="section-label">Users</h2>
      <div className="card list" data-testid="users-list">
        {error && (
          <div className="row">
            <span className="field-error">{error}</span>
            <button className="btn small" onClick={load}>
              Retry
            </button>
          </div>
        )}
        {!users && !error && (
          <div className="row muted" aria-busy="true">
            <span className="spinner inline" /> Loading users…
          </div>
        )}
        {users?.map((u) => (
          <button key={u.user_id} className="row" onClick={() => setEditing(u)} data-testid="user-row">
            <div className="row-main">
              <div className="row-title">
                <b>{u.display_name}</b>
                <span className="muted">@{u.username}</span>
              </div>
              <div className="row-chips">
                <span className={`pill${u.role === 'ADMIN' ? ' accent' : ''}`}>{roleLabel(u.role)}</span>
                {u.status === 'DISABLED' && <span className="pill warn">Disabled</span>}
                {u.locked && <span className="pill warn">Locked</span>}
                {u.must_change_password && u.status === 'ACTIVE' && <span className="pill">Must set own password</span>}
                {u.groups.map((g) => (
                  <span key={g} className="pill">
                    {gname(g)}
                  </span>
                ))}
              </div>
            </div>
            <Icon name="chevron" size={18} className="muted" />
          </button>
        ))}
        <button className="row add-row" onClick={() => setAdding(true)} disabled={!users}>
          <Icon name="plus" size={20} /> Add user
        </button>
      </div>
      {adding && (
        <AddUserSheet
          groups={groups}
          onClose={() => setAdding(false)}
          onCreated={(c) => {
            setAdding(false);
            setCreds(c);
            load();
          }}
        />
      )}
      {editing && (
        <EditUserSheet
          user={editing}
          groups={groups}
          isSelf={editing.user_id === me?.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
          onCredentials={(c) => {
            setEditing(null);
            setCreds(c);
            load();
          }}
        />
      )}
      {creds && <CredentialsSheet creds={creds} onClose={() => setCreds(null)} />}
    </>
  );
}
