// Move a case to another group (owner, step 6; Admin only): it takes the next number there, the old number stays in
// the case History.
import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { groupColor } from '../lib/filters';
import { useStore } from '../store';
import { Sheet } from './ui';

export function MoveCaseSheet({ caseId, mrn, groupId, seq, onMoved, onClose }: { caseId: string; mrn: string; groupId: string; seq: number; onMoved: () => Promise<unknown>; onClose: () => void }) {
  const { groups, toast } = useStore();
  const others = groups.filter((g) => g.group_id !== groupId);
  const [to, setTo] = useState(others[0]?.group_id ?? '');
  const [busy, setBusy] = useState(false);
  const target = groups.find((g) => g.group_id === to);
  const from = groups.find((g) => g.group_id === groupId);
  const move = async () => {
    setBusy(true);
    try {
      await api('POST', `/api/cases/${caseId}/move`, { group_id: to });
      await onMoved();
      toast({ message: `Moved to ${target?.name ?? 'the group'}`, kind: 'success' });
      onClose();
    } catch (e) {
      toast({ message: (e as ApiError).message, kind: 'error' });
      setBusy(false);
    }
  };
  return (
    <Sheet title="Move to Another Group" onClose={onClose} testId="move-sheet">
      <p className="muted small">
        MRN {mrn} · now {from?.name ?? 'its group'}, No. {seq}
      </p>
      <div className="group" role="radiogroup" aria-label="Group">
        {groups.map((g) => {
          const now = g.group_id === groupId;
          return (
            <button key={g.group_id} type="button" role="radio" aria-checked={to === g.group_id} className="grow-row" disabled={now} onClick={() => setTo(g.group_id)}>
              <span className="gdot" style={{ background: `var(--${groupColor(groups, g.group_id)})` }} aria-hidden />
              <span className="grow">{now ? `${g.name} (now)` : g.name}</span>
              {to === g.group_id && <b style={{ color: 'var(--accent)' }}>✓</b>}
            </button>
          );
        })}
      </div>
      {target && (
        <p className="note">
          It gets the next number in {target.name}
          {target.next_seq ? `: No. ${target.next_seq}` : ''}. The old number ({from?.name} No. {seq}) stays in History. Its collector keeps it only if they are in {target.name}.
        </p>
      )}
      <button className="btn primary block" onClick={move} disabled={!to || busy} data-testid="move-confirm">
        {busy ? 'Moving…' : `Move to ${target?.name ?? '…'}`}
      </button>
    </Sheet>
  );
}
