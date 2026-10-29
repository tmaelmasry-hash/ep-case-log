import { useAuth } from '../auth';
import { Icon } from './Icon';

/** Menu footer (owner, step 5): your name; tapping it opens your account in Settings. */
export function UserLink({ onClick }: { onClick?: () => void }) {
  const { me } = useAuth();
  if (!me) return null;
  return (
    <a className="user-link" href="#/settings" onClick={onClick} data-testid="sidebar-user">
      <span className="user-av" aria-hidden>
        {me.name.trim().replace(/^dr\.?\s*/i, '').charAt(0).toUpperCase() || '?'}
      </span>
      <span className="grow">
        <span className="user-name">{me.name}</span>
        <span className="user-sub">{me.role === 'ADMIN' ? 'Admin' : 'Member'} · My account</span>
      </span>
      <Icon name="chevron" size={14} />
    </a>
  );
}
