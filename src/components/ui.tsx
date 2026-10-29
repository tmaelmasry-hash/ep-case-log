import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { sync } from '../lib/sync';
import { Icon } from './Icon';
import { SyncSheet } from './SyncSheet';

export function Sheet({
  title,
  onClose,
  onDone,
  doneLabel = 'Done',
  closeLabel = 'Cancel',
  doneDisabled,
  children,
  wide,
  testId,
}: {
  title: string;
  onClose: () => void;
  onDone?: () => void;
  closeLabel?: string;
  doneLabel?: string;
  doneDisabled?: boolean;
  children: ReactNode;
  wide?: boolean;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} data-testid={testId}>
        <header className="sheet-head">
          <button className={onDone ? 'link cancel' : 'link'} onClick={onClose}>
            {closeLabel}
          </button>
          <h2>{title}</h2>
          {onDone ? (
            <button className="link strong" onClick={onDone} disabled={doneDisabled}>
              {doneLabel}
            </button>
          ) : (
            <span />
          )}
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Confirm({
  title,
  message,
  confirmLabel,
  danger = true,
  typeToConfirm,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  typeToConfirm?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const ok = !typeToConfirm || typed.trim() === typeToConfirm;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <div className="dialog-msg">{message}</div>
        {typeToConfirm && (
          <label className="field">
            <span>
              Type <b>{typeToConfirm}</b> to confirm
            </span>
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Confirmation text" />
          </label>
        )}
        <div className="dialog-actions">
          <button className="btn" onClick={onCancel} autoFocus={!typeToConfirm}>
            Cancel
          </button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={!ok} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind ?? 'info'}`}>
          <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'check' : 'info'} size={18} />
          <span>{t.message}</span>
          {t.undo && (
            <button
              className="link strong"
              onClick={() => {
                t.undo!();
                dismissToast(t.id);
              }}
            >
              Undo
            </button>
          )}
          <button className="icon-btn small" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Segmented({
  options,
  value,
  onChange,
  label,
  allowClear = true,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  label: string;
  allowClear?: boolean;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          className={value === o ? 'on' : ''}
          onClick={() => onChange(value === o && allowClear ? '' : o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function ChipSelect({ options, value, onChange, label }: { options: string[]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button key={o} type="button" aria-pressed={on} className={`chip-toggle${on ? ' on' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={30} />
      </div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/** Local-first (R3-4): what this device still has to send. Tapping it opens the Sync sheet. */
export function SaveIndicator() {
  const s = useSyncExternalStore(sync.subscribe, sync.getState);
  const [open, setOpen] = useState(false);
  const [text, cls] = s.attention
    ? [`${s.attention} needs attention`, 'err']
    : s.waiting && s.offline
      ? [`Offline · ${s.waiting} waiting`, 'warn']
      : s.waiting
        ? [`Syncing ${s.waiting}…`, 'sync']
        : s.lastSynced
          ? ['Synced', 'ok']
          : ['', ''];
  return (
    <>
      <button type="button" className={`save-ind ${cls}`} data-testid="save-indicator" aria-live="polite" onClick={() => setOpen(true)} hidden={!text}>
        {text}
      </button>
      {/* The indicator also sits in the sidebar footer: the sheet goes to the page body so it is never clipped. */}
      {open && createPortal(<SyncSheet onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

export function useHashRoute(): [string[], (path: string) => void] {
  const parse = () => (window.location.hash.replace(/^#\/?/, '') || 'mywork').split('/').map(decodeURIComponent);
  const [route, setRoute] = useState<string[]>(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const nav = (path: string) => {
    window.location.hash = '#/' + path;
  };
  return [route, nav];
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}
