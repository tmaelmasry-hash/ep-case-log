import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth';
import { ApiError } from '../lib/api';
import { Icon } from '../components/Icon';

function Brand() {
  return (
    <div className="auth-brand">
      <div className="app-icon" aria-hidden>
        <Icon name="spike" size={34} />
      </div>
      <h1>EP Case Log</h1>
      <p className="muted">Electrophysiology registry</p>
    </div>
  );
}

export function SignIn({ notice }: { notice?: string }) {
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => {
    try {
      return localStorage.getItem('ep.remember') !== '0';
    } catch {
      return true;
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem('ep.remember', remember ? '1' : '0');
    } catch {
      /* storage blocked */
    }
    try {
      await signIn(username.trim(), password, remember);
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit} noValidate aria-label="Sign in">
        <Brand />
        {notice && !error && <p className="auth-notice" role="status">{notice}</p>}
        <div className="ios-group">
          <input className="ios-input" id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Username" aria-label="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input className="ios-input" id="password" name="password" type="password" autoComplete="current-password" placeholder="Password" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <label className="ios-group ios-row switch-row">
          <span>Keep me signed in (30 days)</span>
          <span className="switch">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} aria-label="Keep me signed in (30 days)" />
            <span className="switch-ui" />
          </span>
        </label>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button className="ios-btn" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
        {import.meta.env.VITE_DEMO && <DemoPanel onPick={(u) => signIn(u, import.meta.env.VITE_DEMO_PASSWORD, false).catch((err) => setError((err as ApiError).message))} />}
        <p className="auth-foot muted">
          Accounts are created by the Admin.
          <br />
          Forgot your password? Ask the Admin to set a new one.
        </p>
      </form>
    </main>
  );
}

/** Try-it demo only: made-up registry in this browser; one tap signs in as the demo Admin or Member. */
function DemoPanel({ onPick }: { onPick: (username: string) => void }) {
  const reset = () => {
    try {
      localStorage.removeItem(import.meta.env.VITE_DEMO ?? '');
      sessionStorage.clear();
    } catch {
      /* storage blocked */
    }
    location.reload();
  };
  return (
    <div className="auth-notice demo-panel" data-testid="demo-panel">
      <p>
        <b>Demo.</b> Made-up patients only; changes stay in this browser. Excel download and printing do not work inside this preview.
      </p>
      <div className="demo-actions">
        <button type="button" className="btn small" onClick={() => onPick('admin')}>
          Sign in as Admin
        </button>
        <button type="button" className="btn small" onClick={() => onPick('sara')}>
          Sign in as Member
        </button>
        <button type="button" className="btn small" onClick={reset}>
          Start again
        </button>
      </div>
    </div>
  );
}

/** Shown after sign-in while the account still has a temporary password. */
export function ChangePasswordScreen() {
  const { me, changePassword, signOut } = useAuth();
  return (
    <main className="auth-page">
      <div className="auth-card">
        <Brand />
        <h2 className="auth-title">Choose your own password</h2>
        <p className="muted small center">Hello {me?.name}. You signed in with a temporary password. Choose a new one to continue.</p>
        <PasswordForm onSubmit={changePassword} submitLabel="Save and continue" />
        <button className="ios-btn plain" onClick={signOut}>
          Sign out
        </button>
      </div>
    </main>
  );
}

export function PasswordForm({ onSubmit, submitLabel }: { onSubmit: (current: string, next: string) => Promise<void>; submitLabel: string }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 10) return setError('The new password must be at least 10 characters.');
    if (next !== again) return setError('The two new passwords are not the same.');
    setBusy(true);
    setError(null);
    try {
      await onSubmit(current, next);
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate aria-label="Change password">
      <div className="ios-group">
        <input className="ios-input" type="password" autoComplete="current-password" placeholder="Current password" aria-label="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input className="ios-input" type="password" autoComplete="new-password" placeholder="New password (10+ characters)" aria-label="New password" value={next} onChange={(e) => setNext(e.target.value)} />
        <input className="ios-input" type="password" autoComplete="new-password" placeholder="New password again" aria-label="New password again" value={again} onChange={(e) => setAgain(e.target.value)} />
      </div>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <button className="ios-btn" type="submit" disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
