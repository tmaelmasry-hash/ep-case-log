// Cohorts of one case (owner R2-12): tag cohorts can be ticked by the Admin; rule cohorts only show ("joined by rule").
import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useCohorts } from '../lib/cohorts';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { Icon } from './Icon';
import { Sheet } from './ui';

export function CaseCohortsSheet({ caseId, member, onChanged, onClose }: { caseId: string; member: string[]; onChanged: () => Promise<unknown>; onClose: () => void }) {
  const cohorts = useCohorts();
  const admin = useAuth().can('cohorts.manage');
  const { toast } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const tags = cohorts.filter((c) => c.kind === 'tag');
  const rules = cohorts.filter((c) => c.kind === 'rule' && member.includes(c.id));

  const toggle = async (id: string, on: boolean) => {
    setBusy(id);
    setShown((s) => ({ ...s, [id]: on }));
    try {
      await api('POST', `/api/cohorts/${id}/cases/${caseId}`, { on });
      await onChanged();
    } catch (e) {
      setShown((s) => ({ ...s, [id]: !on }));
      toast({ message: (e as ApiError).message, kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet title="Cohorts" onClose={onClose} closeLabel="Close" testId="case-cohorts-sheet">
      {tags.length > 0 && (
        <>
          <h2 className="section-label">By tag</h2>
          <div className="group">
            {tags.map((c) => {
              const on = shown[c.id] ?? member.includes(c.id);
              return (
                <label key={c.id} className="grow-row" style={{ ['--dot' as string]: `var(--${c.color})` }}>
                  <input type="checkbox" checked={on} disabled={!admin || busy === c.id} onChange={(e) => toggle(c.id, e.target.checked)} aria-label={c.name} />
                  <span className="grow">{c.name}</span>
                  {c.note && <span className="muted small">{c.note}</span>}
                </label>
              );
            })}
          </div>
          {!admin && <p className="muted small">Only the Admin adds cases to a cohort.</p>}
        </>
      )}
      <h2 className="section-label">By rule</h2>
      {rules.length ? (
        <div className="group">
          {rules.map((c) => (
            <div key={c.id} className="grow-row">
              <Icon name="filter" size={16} className="muted" />
              <span className="grow">{c.name}</span>
              <span className="muted small">joined by rule</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small">This case meets no rule cohort.</p>
      )}
      {!tags.length && admin && <p className="muted small">Make a tag cohort from the menu (Cohorts › New cohort) to add cases by hand.</p>}
    </Sheet>
  );
}
