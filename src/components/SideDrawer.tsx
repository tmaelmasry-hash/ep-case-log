// Phone drawer that slides in from the left (owner): stays open while several items are picked; Done closes it.
import { useEffect, useRef, type ReactNode } from 'react';

export function SideDrawer({ title, onClose, children, testId }: { title: string; onClose: () => void; children: ReactNode; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="side-drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} data-testid={testId}>
        <header className="sheet-head">
          <span />
          <h2>{title}</h2>
          <button className="link strong" onClick={onClose}>
            Done
          </button>
        </header>
        <div className="side-drawer-body">{children}</div>
      </div>
    </div>
  );
}
