import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, hasCsrf, onSessionEnded } from './lib/api';

export interface Me {
  id: string;
  username: string;
  name: string;
  role: 'ADMIN' | 'MEMBER';
  capabilities: string[];
  must_change_password: boolean;
  groups: string[];
  /** Switches from config/site.json (follow-up bell is off unless the Admin turns it on). */
  features?: { followup_bell: boolean };
}

type State = { status: 'loading' } | { status: 'signedOut'; notice?: string } | { status: 'offline'; message: string } | { status: 'signedIn'; me: Me };

interface AuthCtx {
  state: State;
  me: Me | null;
  can: (cap: string) => boolean;
  signIn: (username: string, password: string, remember: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  retry: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

// The last signed-in user on this device (name, role, groups; no password, no token), so the app can open offline.
const ME_KEY = 'kamc-registry-me';
function remember(me: Me | null) {
  try {
    if (me) localStorage.setItem(ME_KEY, JSON.stringify(me));
    else localStorage.removeItem(ME_KEY);
  } catch {
    /* storage blocked: offline opening is not available */
  }
}
function remembered(): Me | null {
  try {
    const v = localStorage.getItem(ME_KEY);
    return v ? (JSON.parse(v) as Me) : null;
  } catch {
    return null;
  }
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside provider');
  return c;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  const loadMe = useCallback(async () => {
    try {
      const r = await api<{ user: Me; features?: Me['features'] }>('GET', '/api/auth/me');
      const me = { ...r.user, features: r.features };
      remember(me);
      setState({ status: 'signedIn', me });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        remember(null);
        setState({ status: 'signedOut' });
        return;
      }
      // Local-first L3: no connection, but this device was signed in before: open from the device copy.
      const last = err.status === 0 ? remembered() : null;
      if (last) setState((s) => (s.status === 'signedIn' ? s : { status: 'signedIn', me: last }));
      else setState({ status: 'offline', message: err.message });
    }
  }, []);

  useEffect(() => {
    loadMe();
    onSessionEnded(() => {
      remember(null);
      setState({ status: 'signedOut', notice: 'Your session ended. Please sign in again.' });
    });
    // Opened offline: check the sign-in again when the connection is back (this also fetches the CSRF token).
    const back = () => !hasCsrf() && loadMe();
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  }, [loadMe]);

  const signIn = useCallback(
    async (username: string, password: string, remember: boolean) => {
      await api('POST', '/api/auth/login', { username, password, remember });
      await loadMe();
    },
    [loadMe],
  );

  const signOut = useCallback(async () => {
    try {
      await api('POST', '/api/auth/logout');
    } finally {
      // The case copy stays on the device (owner R3-4); opening offline needs a new sign-in first.
      remember(null);
      setState({ status: 'signedOut' });
    }
  }, []);

  const changePassword = useCallback(
    async (current: string, next: string) => {
      await api('POST', '/api/auth/password', { current_password: current, new_password: next });
      await loadMe();
    },
    [loadMe],
  );

  const value = useMemo<AuthCtx>(() => {
    const me = state.status === 'signedIn' ? state.me : null;
    return { state, me, can: (cap) => !!me?.capabilities.includes(cap), signIn, signOut, changePassword, retry: loadMe };
  }, [state, signIn, signOut, changePassword, loadMe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
