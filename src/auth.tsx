import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, onSessionEnded } from './lib/api';

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
      setState({ status: 'signedIn', me: { ...r.user, features: r.features } });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) setState({ status: 'signedOut' });
      else setState({ status: 'offline', message: err.message });
    }
  }, []);

  useEffect(() => {
    loadMe();
    onSessionEnded(() => setState({ status: 'signedOut', notice: 'Your session ended. Please sign in again.' }));
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
