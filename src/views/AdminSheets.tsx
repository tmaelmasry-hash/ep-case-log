// Admin screens (approved phase 3 preview): groups (add, rename), recycle bin (restore), activity log.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { fmtDate } from '../lib/util';
import { useStore, type GroupRow } from '../store';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/ui';

/** Add a group (no group given) or rename one. Returns the new group's id on add. */
export function GroupNameDialog({ group, onClose, onSaved }: { group?: GroupRow; onClose: () => void; onSaved: (id?: string) => void }) {
  const { refreshCases, toast } = useStore();
  const [name, setName] = useState(group?.name ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = group ? await api<{ ok: true }>('PATCH', `/api/groups/${group.group_id}`, { name }) : await api<{ group_id: string }>('POST', '/api/groups', { name });
      await refreshCases();
      toast({ message: group ? 'Group renamed' : `Group ${name.trim()} added`, kind: 'success' });
      onSaved('group_id' in r ? r.group_id : undefined);
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  };
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={group ? 'Rename group' : 'Add group'} data-testid="group-dialog">
        <h2>{group ? 'Rename group' : 'Add group'}</h2>
        <div className="dialog-msg">{group ? 'Case numbers do not change.' : 'Case numbers in the new group start at No. 1.'}</div>
        <input
          className="ios-text box"
          autoFocus
          maxLength={40}
          placeholder="Group name"
          aria-label="Group name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && save()}
        />
        {err && (
          <p className="field-error" role="alert">
            {err}
          </p>
        )}
        <div className="dialog-actions" style={{ marginTop: 12 }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!name.trim() || busy} onClick={save}>
            {group ? 'Rename' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function GroupsSheet({ onClose }: { onClose: () => void }) {
  const { groups } = useStore();
  const [edit, setEdit] = useState<GroupRow | 'new' | null>(null);
  return (
    <Sheet title="Groups" closeLabel="Close" onClose={onClose} onDone={onClose} testId="groups-sheet">
      <div className="group">
        {groups.map((g) => (
          <div key={g.group_id} className="grow-row" data-testid="group-row">
            <span className="grow">
              <span className="line1">{g.name}</span>
              <span className="sub">
                {g.cases ?? 0} case{g.cases === 1 ? '' : 's'} · next No. {g.next_seq ?? 1}
              </span>
            </span>
            <button className="link small" onClick={() => setEdit(g)}>
              Rename
            </button>
          </div>
        ))}
        <button className="grow-row add" onClick={() => setEdit('new')}>
          <span className="row-ic">
            <Icon name="plus" size={20} />
          </span>
          Add group
        </button>
      </div>
      <p className="note">Renaming does not change case numbers. A group with cases cannot be removed.</p>
      {edit && <GroupNameDialog group={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSaved={() => setEdit(null)} />}
    </Sheet>
  );
}

interface BinRow {
  case_id: string;
  mrn: string;
  group_name: string;
  group_seq: number;
  deleted_at: string | null;
  deleted_by: string | null;
}

export function useRecycleBin(enabled: boolean) {
  const [rows, setRows] = useState<BinRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      setRows((await api<{ cases: BinRow[] }>('GET', '/api/recycle-bin')).cases);
      setError(null);
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, [enabled]);
  useEffect(() => {
    load();
  }, [load]);
  return { rows, error, load };
}

export function RecycleBinSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { refreshCases, toast } = useStore();
  const { rows, error, load } = useRecycleBin(true);
  const [busy, setBusy] = useState<string | null>(null);
  const restore = async (r: BinRow) => {
    setBusy(r.case_id);
    try {
      await api('POST', `/api/cases/${r.case_id}/restore`, {});
      toast({ message: `MRN ${r.mrn} restored to ${r.group_name} as No. ${r.group_seq}`, kind: 'success' });
      await Promise.all([load(), refreshCases()]);
      onChanged();
    } catch (e) {
      toast({ message: (e as ApiError).message, kind: 'error' });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet title="Recycle Bin" closeLabel="Close" onClose={onClose} onDone={onClose} testId="bin-sheet">
      <div className="group">
        {error && <div className="grow-row field-error">{error}</div>}
        {!rows && !error && (
          <div className="grow-row muted">
            <span className="spinner inline" /> Loading…
          </div>
        )}
        {rows?.length === 0 && <div className="grow-row muted">The recycle bin is empty.</div>}
        {rows?.map((r) => (
          <div key={r.case_id} className="grow-row" data-testid="bin-row">
            <span className="grow">
              <span className="line1">
                <b>{r.mrn}</b>
                <span className="muted">
                  {' '}
                  · {r.group_name} · No. {r.group_seq}
                </span>
              </span>
              <span className="sub">
                Deleted{r.deleted_by ? ` by ${r.deleted_by}` : ''}
                {r.deleted_at ? ` · ${fmtDate(r.deleted_at.slice(0, 10))}` : ''}
              </span>
            </span>
            <button className="btn admin-row-btn" disabled={busy === r.case_id} onClick={() => restore(r)}>
              Restore
            </button>
          </div>
        ))}
      </div>
      <p className="note">Restore puts the case back in its group with its old number. Admin only.</p>
    </Sheet>
  );
}

interface ActivityItem {
  at: string;
  kind: string;
  actor: string;
  case_id: string | null;
  mrn: string | null;
  group: string | null;
  details: string;
}

const KIND_CLASS: Record<string, string> = { 'NEW CASE': 'add', ADD: 'add', RESTORE: 'add', DELETE: 'del', REMOVE: 'del', LOCKED: 'del', COMPLETE: 'comp', REOPEN: 'comp' };

function when(iso: string): string {
  const d = new Date(iso);
  const day = (x: Date) => x.toDateString();
  const now = new Date();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (day(d) === day(now)) return `Today ${time}`;
  if (day(d) === day(y)) return `Yesterday ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })} ${time}`;
}

export function ActivitySheet({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    api<{ items: ActivityItem[] }>('GET', '/api/admin/activity')
      .then((r) => setItems(r.items))
      .catch((e: ApiError) => setError(e.message));
  }, []);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (items ?? []).filter((x) => !t || (x.mrn ?? '').includes(t) || x.actor.toLowerCase().includes(t));
  }, [items, q]);
  return (
    <Sheet title="Activity Log" closeLabel="Close" onClose={onClose} onDone={onClose} testId="activity-sheet">
      <div className="search">
        <Icon name="search" size={18} />
        <input type="search" placeholder="Filter by MRN or person" aria-label="Filter by MRN or person" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="group" style={{ marginTop: 12 }}>
        {error && <div className="grow-row field-error">{error}</div>}
        {!items && !error && (
          <div className="grow-row muted">
            <span className="spinner inline" /> Loading…
          </div>
        )}
        {items && !shown.length && <div className="grow-row muted">Nothing to show.</div>}
        {shown.map((x, i) => (
          <div key={i} className="grow-row hist" data-testid="activity-item">
            <span className="grow">
              <span className="hist-when">
                {when(x.at)} · {x.actor} <span className={`kind ${KIND_CLASS[x.kind] ?? ''}`}>{x.kind}</span>
              </span>
              {(x.mrn || x.details) && (
                <span className="hist-what">
                  {x.mrn ? `${x.mrn} · ${x.group}` : ''}
                  {x.details && <span className="muted">{x.mrn ? ' — ' : ''}{x.details}</span>}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      <p className="note">Field names only, never the values typed. Edits by one person to one case within two minutes are one line. Admin only.</p>
    </Sheet>
  );
}
