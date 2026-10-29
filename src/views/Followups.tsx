// Follow-up tab (owner, step 5; was the bell of phase 12): visits and device checks due, overdue or coming up, in the
// user's groups. Shown when config/site.json followup_due.enabled is true. Asks at start and every 10 minutes.
import { useEffect, useMemo, useState } from 'react';
import type { CaseSummary } from '../../shared/caseTypes.ts';
import { api } from '../lib/api';
import { label } from '../lib/dict';
import { fmtDate } from '../lib/util';
import { useStore } from '../store';
import { Icon } from '../components/Icon';
import { Empty } from '../components/ui';
import { procedureChip } from './CasesView';

export interface DueItem {
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

export interface Followups {
  items: DueItem[];
  ahead: number;
  /** Overdue or due within 7 days: the red number on the tab. */
  urgent: number;
}

export function useFollowups(enabled: boolean): Followups {
  const [items, setItems] = useState<DueItem[]>([]);
  const [ahead, setAhead] = useState(90);
  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled]);
  return { items, ahead, urgent: items.filter((i) => i.days <= 7).length };
}

export const dueWhen = (d: number) => (d < 0 ? `${-d} day${d === -1 ? '' : 's'} overdue` : d === 0 ? 'due today' : `in ${d} day${d === 1 ? '' : 's'}`);

/** The device recorded on the case (PPM / ICD / CRT …), from its case-level codes. */
export function deviceOf(c: CaseSummary | undefined): string | null {
  const code = (c?.codes ?? []).find((x) => x.startsWith('DEVICES.current_device_type='))?.split('=')[1];
  return code ? label('DEVICES', 'current_device_type', code) : null;
}

export function DueRow({ i, c }: { i: DueItem; c?: CaseSummary }) {
  const proc = i.procedure_id ? c?.procedures.find((p) => p.id === i.procedure_id) : undefined;
  const device = i.kind === 'device_check' ? deviceOf(c) : null;
  const tone = i.days < 0 ? 'over' : i.days <= 7 ? 'soon' : 'later';
  return (
    <a className="grow-row due-row" href={`#/cases/${i.case_id}`} data-testid="due-item">
      <span className={`due-ic ${tone}`} aria-hidden>
        <Icon name={i.kind === 'visit' ? 'cal' : 'chip'} size={18} />
      </span>
      <span className="grow">
        <span className="line1">
          <b>{i.mrn}</b> · {i.what}
          {device && <span className="dev-chip">{device}</span>}
        </span>
        <span className="sub">
          {proc ? `${procedureChip(proc).text}${proc.start ? ` ${fmtDate(proc.start.slice(0, 10))}` : ''} · ` : ''}due {fmtDate(i.due_date)} · <span className={i.days < 0 ? 'overdue' : ''}>{dueWhen(i.days)}</span>
        </span>
      </span>
      <Icon name="chevron" size={16} className="muted" />
    </a>
  );
}

export function FollowupView({ fu }: { fu: Followups }) {
  const { cases } = useStore();
  const [kind, setKind] = useState<'ALL' | DueItem['kind']>('ALL');
  const byId = useMemo(() => new Map(cases.map((c) => [c.case_id, c])), [cases]);
  const shown = fu.items.filter((i) => kind === 'ALL' || i.kind === kind);
  const parts: [string, string, DueItem[]][] = [
    ['Overdue', 'over', shown.filter((i) => i.days < 0)],
    ['This week', 'soon', shown.filter((i) => i.days >= 0 && i.days <= 7)],
    ['Later', 'later', shown.filter((i) => i.days > 7)],
  ];
  const n = (k: DueItem['kind']) => fu.items.filter((i) => i.kind === k).length;
  return (
    <section className="view" aria-label="Follow-up" data-testid="followup-view">
      <h1 className="large-title">Follow-up</h1>
      <p className="muted small view-sub">Visits and device checks due in the next {fu.ahead} days</p>
      <div className="filter-bar">
        {(
          [
            ['ALL', `All ${fu.items.length}`],
            ['visit', `Visits ${n('visit')}`],
            ['device_check', `Device checks ${n('device_check')}`],
          ] as const
        ).map(([k, t]) => (
          <button key={k} type="button" className={`chip filter-chip quick${kind === k ? ' on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {t}
          </button>
        ))}
      </div>
      {!shown.length ? (
        <Empty icon="check" title="Nothing due">
          <p>No follow-up visit or device check is due in the next {fu.ahead} days.</p>
        </Empty>
      ) : (
        parts
          .filter(([, , list]) => list.length)
          .map(([title, tone, list]) => (
            <div key={title}>
              <h2 className={`sechead due-head ${tone}`}>
                {title} · {list.length}
              </h2>
              <div className="group">
                {list.map((i) => (
                  <DueRow key={`${i.case_id}.${i.procedure_id}.${i.what}`} i={i} c={byId.get(i.case_id)} />
                ))}
              </div>
            </div>
          ))
      )}
    </section>
  );
}
