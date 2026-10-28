// Follow-up bell (phase 12): visits and device checks due, overdue or coming up, in the user's groups.
// Shown only when config/site.json followup_due.enabled is true (off by default). Asks at start and every 10 minutes.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fmtDate } from '../lib/util';
import { useStore } from '../store';
import { Icon } from '../components/Icon';
import { Empty, Sheet } from '../components/ui';

interface DueItem {
  case_id: string;
  procedure_id: string | null;
  mrn: string;
  group_id: string;
  group_seq: number;
  kind: 'visit' | 'device_check';
  what: string;
  due_date: string;
  days: number;
}

const when = (d: number) => (d < 0 ? `${-d} day${d === -1 ? '' : 's'} overdue` : d === 0 ? 'due today' : `in ${d} day${d === 1 ? '' : 's'}`);

export function FollowupBell() {
  const { groups } = useStore();
  const [items, setItems] = useState<DueItem[]>([]);
  const [ahead, setAhead] = useState(90);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const load = () =>
      api<{ items: DueItem[]; ahead_days?: number }>('GET', '/api/followups')
        .then((r) => {
          setItems(r.items);
          if (r.ahead_days) setAhead(r.ahead_days);
        })
        .catch(() => {
          /* offline: keep the last list */
        });
    load();
    const t = window.setInterval(load, 10 * 60_000);
    return () => window.clearInterval(t);
  }, []);
  // The red number: overdue or due within 7 days.
  const urgent = items.filter((i) => i.days <= 7).length;
  const gname = (id: string) => groups.find((g) => g.group_id === id)?.name ?? '';
  return (
    <>
      <button className="icon-btn accent bell" aria-label={`Follow-ups due${urgent ? ` (${urgent})` : ''}`} onClick={() => setOpen(true)} data-testid="followup-bell">
        <Icon name="bell" size={24} />
        {urgent > 0 && <span className="badge">{urgent}</span>}
      </button>
      {open && (
        <Sheet title="Follow-ups due" onClose={() => setOpen(false)} onDone={() => setOpen(false)} testId="followup-due-sheet">
          {items.length ? (
            <div className="group">
              {items.map((i) => (
                <a key={`${i.case_id}.${i.procedure_id}.${i.what}`} className="grow-row" href={`#/cases/${i.case_id}`} onClick={() => setOpen(false)} data-testid="due-item">
                  <span className="grow">
                    <span className="line1">
                      MRN {i.mrn} · {i.what}
                    </span>
                    <span className="sub">
                      {gname(i.group_id)} No. {i.group_seq} · {fmtDate(i.due_date)} · <span className={i.days < 0 ? 'overdue' : ''}>{when(i.days)}</span>
                    </span>
                  </span>
                  <Icon name="chevron" size={16} className="muted" />
                </a>
              ))}
            </div>
          ) : (
            <Empty icon="check" title="Nothing due">
              <p>No follow-up visit or device check is due in the next {ahead} days.</p>
            </Empty>
          )}
        </Sheet>
      )}
    </>
  );
}
