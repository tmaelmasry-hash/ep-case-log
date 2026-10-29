// Desktop, no case open (owner, step 5): a big New case button (Admin only), then the user's open cases (fewest missing
// first, from My work) and the follow-ups due this week.
import { useState } from 'react';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { Icon } from '../components/Icon';
import { NewCaseSheet } from './CasesView';
import { BulkAddSheet } from './BulkAdd';
import { MyWorkRow, useMyWork } from './MyWorkView';
import { DueRow, type Followups } from './Followups';
import { pickGroup } from '../lib/prefs';

export function EmptyPane({ fu, nav }: { fu: Followups; nav: (p: string) => void }) {
  const { can, me } = useAuth();
  const { groups, cases } = useStore();
  const { data: w } = useMyWork();
  const [sheet, setSheet] = useState<'new' | 'bulk' | null>(null);
  const soon = fu.items.filter((i) => i.days <= 7).slice(0, 5);
  const byId = new Map(cases.map((c) => [c.case_id, c]));
  return (
    <div className="empty-pane" data-testid="empty-pane">
      {can('case.create') && groups.length > 0 && (
        <>
          <button className="btn primary big-new" onClick={() => setSheet('new')} data-testid="pane-new-case">
            <Icon name="plus" size={24} /> New case
          </button>
          {can('case.import') && (
            <button className="link small" onClick={() => setSheet('bulk')}>
              or Bulk add MRNs
            </button>
          )}
        </>
      )}
      {w && w.items.length > 0 && (
        <div className="pane-block">
          <h2 className="sechead">
            Your open cases · fewest missing first
            <a href="#/mywork" className="link small">
              All in My work →
            </a>
          </h2>
          <div className="group">
            {w.items.slice(0, 5).map((x) => (
              <MyWorkRow key={x.case_id} x={x} staleDays={w.stale_days} compact />
            ))}
          </div>
        </div>
      )}
      {me?.features?.followups && soon.length > 0 && (
        <div className="pane-block">
          <h2 className="sechead">
            Follow-ups this week
            <a href="#/followup" className="link small">
              All follow-ups →
            </a>
          </h2>
          <div className="group">
            {soon.map((i) => (
              <DueRow key={`${i.case_id}.${i.procedure_id}.${i.what}`} i={i} c={byId.get(i.case_id)} />
            ))}
          </div>
        </div>
      )}
      {!can('case.create') && !w?.items.length && !soon.length && <div className="placeholder">Select a case from the list.</div>}
      {sheet === 'new' && (
        <NewCaseSheet
          defaultGroup={pickGroup(me?.id, groups)}
          onClose={() => setSheet(null)}
          onCreated={(id) => {
            setSheet(null);
            nav(`cases/${id}`);
          }}
        />
      )}
      {sheet === 'bulk' && <BulkAddSheet defaultGroup={pickGroup(me?.id, groups)} onClose={() => setSheet(null)} />}
    </div>
  );
}
