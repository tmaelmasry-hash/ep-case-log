import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { CATEGORIES, CATEGORY_COLOR, PROCEDURES, procCategory, procLabel, procSummary, type Category } from '../lib/catalog';
import { caseCha, caseNeedsCha } from '../lib/cha';
import type { CaseRec } from '../lib/types';
import { fmtDate, fmtMonthKey, monthKey, patientLine } from '../lib/util';
import { Icon } from '../components/Icon';
import { ChipSelect, Empty, SaveIndicator, Sheet } from '../components/ui';
import { CaseInfoSheet } from './CaseInfoSheet';

export interface CaseFilter {
  categories: string[];
  types: string[];
  flags: string[];
}
const EMPTY_FILTER: CaseFilter = { categories: [], types: [], flags: [] };
const FLAGS = ['Has complications', 'CHA₂DS₂-VASc missing', 'Has images'];

export function matchesSearch(c: CaseRec, q: string): boolean {
  if (!q) return true;
  const hay = [c.mrn, c.date, fmtDate(c.date), c.notes, c.complicationNote, ...c.complications, ...c.procedures.flatMap((p) => [procLabel(p), procSummary(p), p.notes])]
    .join(' ')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
}

export function ProcChip({ label, category }: { label: string; category: Category }) {
  return (
    <span className="proc-chip" style={{ ['--chip' as string]: CATEGORY_COLOR[category] }}>
      {label}
    </span>
  );
}

export function ChaBadge({ c }: { c: CaseRec }) {
  if (!caseNeedsCha(c)) return null;
  const r = caseCha(c);
  if (!r)
    return (
      <span className="cha-badge missing" title="CHA₂DS₂-VASc not recorded">
        CHA₂DS₂-VASc ?
      </span>
    );
  return (
    <span className="cha-badge" title={`CHA₂DS₂-VASc ${r.score} (CHA₂DS₂-VA ${r.vaScore})`}>
      CHA₂DS₂-VASc {r.score}
    </span>
  );
}

export function CaseRow({ c, selected, imageCount }: { c: CaseRec; selected?: boolean; imageCount: number }) {
  return (
    <a href={`#/cases/${c.id}`} className={`row case-row${selected ? ' selected' : ''}`} data-testid="case-row" aria-current={selected ? 'true' : undefined}>
      <div className="row-main">
        <div className="row-title">
          <b>{fmtDate(c.date)}</b>
          <span className="muted">{patientLine(c.mrn, c.age, c.sex)}</span>
        </div>
        <div className="row-chips">
          {c.procedures.length === 0 && <span className="muted small">No procedures yet</span>}
          {c.procedures.map((p) => (
            <ProcChip key={p.id} label={procLabel(p)} category={procCategory(p)} />
          ))}
        </div>
      </div>
      <div className="row-side">
        <ChaBadge c={c} />
        {c.complications.length > 0 && (
          <span className="flag-badge" title="Complication recorded">
            <Icon name="alert" size={14} /> {c.complications.length}
          </span>
        )}
        {imageCount > 0 && (
          <span className="muted small" title={`${imageCount} image(s)`}>
            <Icon name="image" size={14} /> {imageCount}
          </span>
        )}
        <Icon name="chevron" size={18} className="muted" />
      </div>
    </a>
  );
}

export function CasesView({ selectedId, nav, inboxCount }: { selectedId?: string; nav: (p: string) => void; inboxCount: number }) {
  const { cases, images } = useStore();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<CaseFilter>(EMPTY_FILTER);
  const [showFilter, setShowFilter] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const imgCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of images) if (i.caseId) m.set(i.caseId, (m.get(i.caseId) ?? 0) + 1);
    return m;
  }, [images]);

  const filtered = useMemo(() => {
    return cases
      .filter((c) => matchesSearch(c, q.trim()))
      .filter((c) => !filter.categories.length || c.procedures.some((p) => filter.categories.includes(procCategory(p))))
      .filter((c) => !filter.types.length || c.procedures.some((p) => filter.types.includes(p.type)))
      .filter((c) => !filter.flags.includes(FLAGS[0]) || c.complications.length > 0)
      .filter((c) => !filter.flags.includes(FLAGS[1]) || (caseNeedsCha(c) && !c.cha))
      .filter((c) => !filter.flags.includes(FLAGS[2]) || (imgCount.get(c.id) ?? 0) > 0)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  }, [cases, q, filter, imgCount]);

  const groups = useMemo(() => {
    const g: { month: string; items: CaseRec[] }[] = [];
    for (const c of filtered) {
      const m = monthKey(c.date);
      if (!g.length || g[g.length - 1].month !== m) g.push({ month: m, items: [] });
      g[g.length - 1].items.push(c);
    }
    return g;
  }, [filtered]);

  const activeFilters = filter.categories.length + filter.types.length + filter.flags.length;

  return (
    <section className="view" aria-label="Cases">
      <div className="toolbar">
        <button className={`icon-btn${activeFilters ? ' active' : ''}`} aria-label={`Filter${activeFilters ? ` (${activeFilters} active)` : ''}`} onClick={() => setShowFilter(true)}>
          <Icon name="filter" />
          {activeFilters > 0 && <span className="dot-badge">{activeFilters}</span>}
        </button>
        <button className="icon-btn" aria-label={`Image inbox (${inboxCount})`} onClick={() => nav('inbox')}>
          <Icon name="inbox" />
          {inboxCount > 0 && <span className="dot-badge red">{inboxCount}</span>}
        </button>
        <span className="grow" />
        <span className="narrow-only">
          <SaveIndicator />
        </span>
        <button className="icon-btn accent" aria-label="New case" onClick={() => setShowNew(true)} data-testid="new-case">
          <Icon name="plus" size={24} />
        </button>
      </div>
      <h1 className="large-title">Cases</h1>
      <div className="search">
        <Icon name="search" size={18} />
        <input type="search" placeholder="Search MRN, procedure, notes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cases" />
      </div>
      {activeFilters > 0 && (
        <div className="active-filters">
          {[...filter.categories, ...filter.types.map((t) => PROCEDURES.find((p) => p.type === t)?.label ?? t), ...filter.flags].map((f) => (
            <span key={f} className="pill">
              {f}
            </span>
          ))}
          <button className="link" onClick={() => setFilter(EMPTY_FILTER)}>
            Clear
          </button>
        </div>
      )}

      {cases.length === 0 ? (
        <Empty icon="cases" title="No cases yet">
          <p>Log your first procedure. Everything is saved on this device automatically.</p>
          <button className="btn primary" onClick={() => setShowNew(true)}>
            <Icon name="plus" size={18} /> New case
          </button>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty icon="search" title="No matching cases">
          <p>Try a different search or clear the filters.</p>
        </Empty>
      ) : (
        <div className="case-groups">
          <p className="muted small count-line" data-testid="case-count">
            {filtered.length} case{filtered.length === 1 ? '' : 's'}
          </p>
          {groups.map((g) => (
            <div key={g.month} className="group">
              <h2 className="group-head">
                {fmtMonthKey(g.month)} <span className="muted">· {g.items.length}</span>
              </h2>
              <div className="card list">
                {g.items.map((c) => (
                  <CaseRow key={c.id} c={c} selected={c.id === selectedId} imageCount={imgCount.get(c.id) ?? 0} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showFilter && (
        <Sheet title="Filter" onClose={() => setShowFilter(false)} onDone={() => setShowFilter(false)}>
          <div className="form-group">
            <h3 className="section-label">Category</h3>
            <ChipSelect label="Category" options={CATEGORIES} value={filter.categories} onChange={(v) => setFilter({ ...filter, categories: v })} />
          </div>
          <div className="form-group">
            <h3 className="section-label">Procedure</h3>
            <div className="chips">
              {PROCEDURES.map((p) => {
                const on = filter.types.includes(p.type);
                return (
                  <button
                    key={p.type}
                    className={`chip-toggle${on ? ' on' : ''}`}
                    aria-pressed={on}
                    onClick={() => setFilter({ ...filter, types: on ? filter.types.filter((t) => t !== p.type) : [...filter.types, p.type] })}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="form-group">
            <h3 className="section-label">Flags</h3>
            <ChipSelect label="Flags" options={FLAGS} value={filter.flags} onChange={(v) => setFilter({ ...filter, flags: v })} />
          </div>
          <button className="btn" onClick={() => setFilter(EMPTY_FILTER)} disabled={!activeFilters}>
            Clear all filters
          </button>
        </Sheet>
      )}
      {showNew && <CaseInfoSheet onClose={() => setShowNew(false)} onCreated={(id) => nav(`cases/${id}/add`)} />}
    </section>
  );
}
