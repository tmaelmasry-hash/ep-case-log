import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider, useAuth } from './auth';
import { StoreProvider } from './store';
import { ChangePasswordScreen, SignIn } from './views/SignIn';
import './styles.css';
import { applyPrefs } from './lib/prefs';

applyPrefs();

function Gate() {
  const { state, retry } = useAuth();
  if (state.status === 'loading') {
    return (
      <div className="loading" aria-busy="true">
        <div className="spinner" />
        <span>Connecting to the registry…</span>
      </div>
    );
  }
  if (state.status === 'offline') {
    return (
      <div className="fatal">
        <h1>Cannot reach the registry server</h1>
        <p>{state.message}</p>
        <button className="btn primary" onClick={retry}>
          Try again
        </button>
      </div>
    );
  }
  if (state.status === 'signedOut') return <SignIn notice={state.notice} />;
  if (state.me.must_change_password) return <ChangePasswordScreen />;
  return (
    <StoreProvider userId={state.me.id}>
      <App />
    </StoreProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <Gate />
    </AuthProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD && !import.meta.env.VITE_DEMO) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Service worker registration failed', e));
  });
}
