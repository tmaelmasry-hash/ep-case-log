// Category menu (owner R2-4, revised 23 Oct): Procedures tree, Cohorts and Period, with counts that follow the other
// filters. Several items can be picked at once (any of them). Used in the desktop sidebar and the phone drawer.
import { useState } from 'react';
import type { CategoryItem } from '../../shared/categories.ts';
import { UNCLASSIFIED } from '../../shared/categories.ts';
import type { CaseSummary } from '../../shared/caseTypes.ts';
import { applyFilters, clearFilters, itemColor, matcher, setFilters, toggleFilter, useFilters, useTagged } from '../lib/filters';
import { hijriPresets } from '../lib/hijri';
import { fmtDate, todayISO } from '../lib/util';
import { Icon } from './Icon';

function loadOpen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem('ep.tree.open') ?? '["ABLATION"]'));
  } catch {
    return new Set(['ABLATION']);
  }
}

/** The item's own icon, else its nearest parent's. */
function iconOf(id: string): string {
  let it = matcher.item(id.split('@')[0]);
  while (it && !it.icon && it.parent) it = matcher.item(it.parent);
  return it?.icon ?? 'info';
}

function periodPresets(): [string, string, string][] {
  const today = todayISO();
  const y = Number(today.slice(0, 4));
  const d = new Date(`${today}T12:00:00`);
  d.setMonth(d.getMonth() - 3);
  return [
    ['This month', `${today.slice(0, 7)}-01`, today],
    ['Last 3 months', todayISO(d), today],
    ['This year', `${y}-01-01`, today],
    ['Last year', `${y - 1}-01-01`, `${y - 1}-12-31`],
    ...hijriPresets(),
  ];
}

export function CategoryTree({ cases, onCustomPeriod }: { cases: CaseSummary[]; onCustomPeriod: () => void }) {
  const f = useFilters();
  const tagged = useTagged(cases);
  const [open, setOpen] = useState(loadOpen);
  const forProc = applyFilters(cases, tagged, f, 'proc');
  const forGroup = applyFilters(cases, tagged, f, 'group');
  const count = (pool: CaseSummary[], id: string) => pool.reduce((n, c) => n + (tagged.get(c.case_id)!.has(id) ? 1 : 0), 0);

  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
    try {
      localStorage.setItem('ep.tree.open', JSON.stringify([...next]));
    } catch {
      /* storage blocked */
    }
  };

  const row = (it: { id: string; label: string }, side: 'proc' | 'group', depth: number, kids: { id: string; label: string }[]) => {
    const pool = side === 'proc' ? forProc : forGroup;
    const on = f[side].includes(it.id);
    const hasKids = kids.length > 0;
    const n = count(pool, it.id);
    return (
      <li key={it.id}>
        <div className={`cat-row${depth === 0 ? ' top' : ' sub'}${on ? ' on' : ''}`} style={{ paddingLeft: 4 + depth * 14, ['--dot' as string]: `var(--${itemColor(it.id)})` }}>
          {hasKids ? (
            <button type="button" className="cat-arrow" aria-label={`${open.has(it.id) ? 'Close' : 'Open'} ${it.label}`} aria-expanded={open.has(it.id)} onClick={() => toggle(it.id)}>
              <Icon name="chevron" size={14} className={open.has(it.id) ? 'rot90' : ''} />
            </button>
          ) : (
            <span className="cat-arrow" />
          )}
          <button type="button" className="cat-name" aria-pressed={on} onClick={() => toggleFilter(side, it.id)} data-testid={`cat-${it.id}`}>
            <span className="cat-ic" aria-hidden>
              <Icon name={iconOf(it.id)} size={depth === 0 ? 16 : 13} />
            </span>
            <span className="grow">{it.label}</span>
            <span className={`cat-count${n ? '' : ' zero'}`}>{n}</span>
          </button>
        </div>
        {hasKids && open.has(it.id) && <ul className="cat-list">{kids.map((k) => tree(k as CategoryItem, side, depth + 1))}</ul>}
      </li>
    );
  };

  function tree(it: CategoryItem, side: 'proc' | 'group', depth: number): JSX.Element {
    if (!matcher.item(it.id)) return row(it, side, depth, []); // a year child
    const kids: { id: string; label: string }[] = it.years
      ? matcher.yearsOf(it.id, [...tagged.values()]).map((y) => ({ id: `${it.id}@${y}`, label: `${it.label} ${y}` }))
      : matcher.children(it.id);
    return row(it, side, depth, kids);
  }

  const roots = matcher.children(null);
  const unclassified = count(forProc, UNCLASSIFIED);
  const presets = periodPresets();
  const anyFilter = !!(f.proc.length || f.group.length || f.from || f.to);
  return (
    <div className="cat-tree" data-testid="category-tree">
      <ul className="cat-list">
        <li>
          <div className={`cat-row top${f.proc.length === 0 ? ' on' : ''}`} style={{ paddingLeft: 4 }}>
            <span className="cat-arrow" />
            <button type="button" className="cat-name" aria-pressed={f.proc.length === 0} onClick={() => setFilters({ proc: [] })} data-testid="cat-ALL">
              <span className="cat-ic" aria-hidden>
                <Icon name="list" size={16} />
              </span>
              <span className="grow">All procedures</span>
              <span className="cat-count">{forProc.length}</span>
            </button>
          </div>
        </li>
      </ul>
      <div className="cat-head">Procedures</div>
      <ul className="cat-list">
        {roots.filter((r) => r.section === 'procedures').map((r) => tree(r, 'proc', 0))}
        {unclassified > 0 && row({ id: UNCLASSIFIED, label: 'Unclassified' }, 'proc', 0, [])}
      </ul>
      <div className="cat-head">Cohorts</div>
      <ul className="cat-list">{roots.filter((r) => r.section === 'groups').map((r) => tree(r, 'group', 0))}</ul>
      <div className="cat-head">Period</div>
      <div className="cat-period" data-testid="period-menu">
        {presets.map(([label, a, b]) => {
          const on = f.from === a && f.to === b;
          return (
            <button key={label} type="button" className={`pill${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setFilters(on ? { from: null, to: null } : { from: a, to: b })}>
              {label}
            </button>
          );
        })}
        <button type="button" className="pill" onClick={onCustomPeriod}>
          {f.from || f.to ? `${f.from ? fmtDate(f.from) : '…'} – ${f.to ? fmtDate(f.to) : '…'}` : 'From – To…'}
        </button>
      </div>
      {anyFilter && (
        <button type="button" className="link small cat-clear" onClick={clearFilters}>
          Clear all filters
        </button>
      )}
    </div>
  );
}
