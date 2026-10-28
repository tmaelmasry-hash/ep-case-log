// Cases list (approved EP Log-style preview): group switcher, search, cases grouped by month of the episode start,
// each row = date · MRN · age/sex, a chip per procedure, then No. · status.
import { useMemo, useState, type CSSProperties } from 'react';
import type { CaseSummary, ProcedureSummary } from '../../shared/caseTypes.ts';
import { checkMrn } from '../../shared/mrn.ts';
import { label, mrnRules } from '../lib/dict';
import { api, ApiError } from '../lib/api';
import { ageSex, fmtDate, fmtMonthKey, monthKey, todayISO } from '../lib/util';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { Icon } from '../components/Icon';
import { Empty, SaveIndicator, Sheet, useMediaQuery } from '../components/ui';
import { CategoryTree } from '../components/CategoryTree';
import { applyFilters, clearFilters, componentColor, itemColor, itemLabel, setFilters, toggleFilter, useFilters, useTagged } from '../lib/filters';
import { PeriodSheet } from '../components/PeriodSheet';
import { SideDrawer } from '../components/SideDrawer';
import { downloadXlsx } from '../lib/exportFile';
import { GroupNameDialog } from './AdminSheets';
import { makeOfflineCase, seqText } from '../lib/offlineCase';
import { sync, useOnline } from '../lib/sync';
import { BulkAddSheet } from './BulkAdd';
import { FollowupBell } from './FollowupBell';

const CHIP_CLASS: Record<string, string> = { ABLATION: 'c-abl', EPS: 'c-eps', CIED_IMPLANT: 'c-dev', GENERATOR_CHANGE: 'c-dev', LEAD_REVISION: 'c-dev', EXTRACTION: 'c-dev', ILR: 'c-dev' };

export function procedureChip(p: ProcedureSummary): { text: string; cls: string; color: string | null } {
  const comps = p.components.map((c) => label('PROCEDURE_COMPONENTS', 'component_type', c));
  const type = p.type ? label('EP_PROCEDURES', 'primary_procedure_type', p.type) : null;
  const text = type === 'Ablation' && comps.length ? `${comps.join(' + ')} Ablation` : [type, comps.length && type !== 'Ablation' ? comps.join(' + ') : null].filter(Boolean).join(' · ') || 'Procedure';
  // Colored by its first component's category (R2-3); without components, by procedure type as before.
  return { text, cls: p.components.length ? 'c-cat' : (p.type && CHIP_CLASS[p.type]) || 'c-neutral', color: p.components.length ? componentColor(p.components[0]) : null };
}

/** Search (owner R2-8; case No. dropped 28 Oct): digits match the MRN; words match a procedure or category name. */
export function matchesSearch(c: CaseSummary, term: string, tags: Set<string>): boolean {
  if (/^\d+$/.test(term)) return c.mrn.includes(term);
  const words = [...c.procedures.map((p) => procedureChip(p).text), ...[...tags].map(itemLabel)].join(' ').toLowerCase();
  return term.split(/\s+/).every((w) => words.includes(w));
}

export function CaseRow({ c, selected, showGroup }: { c: CaseSummary; selected?: boolean; showGroup?: string }) {
  return (
    <a href={`#/cases/${c.case_id}`} className={`grow-row case-row${selected ? ' sel' : ''}`} data-testid="case-row" aria-current={selected ? 'true' : undefined}>
      <span className="grow">
        <span className="line1">
          <b>{c.episode_start_date ? fmtDate(c.episode_start_date) : 'No date'}</b>
          <span className="muted">
            {' '}
            · {c.mrn}
            {ageSex(c.age, c.sex) ? ` · ${ageSex(c.age, c.sex)}` : ''}
          </span>
        </span>
        <span className="chips">
          {c.procedures.length ? (
            c.procedures.map((p) => {
              const ch = procedureChip(p);
              return (
                <span key={p.id} className={`chip ${ch.cls}`} style={ch.color ? ({ '--chip': `var(--${ch.color})` } as CSSProperties) : undefined}>
                  {ch.text}
                </span>
              );
            })
          ) : (
            <span className="chip c-neutral">MRN only</span>
          )}
        </span>
        <span className="sub">
          {showGroup ? `${showGroup} · ` : ''}{seqText(c.group_seq)} · {sync.isLocalOnly(c.case_id) && <span className="chip c-neutral" data-testid="device-only">On this device only</span>} <span className={`status ${c.collection_status === 'COMPLETED' ? 's-done' : 's-prog'}`}>{c.collection_status === 'COMPLETED' ? 'Completed' : 'In progress'}</span>
          {c.procedures.length > 1 ? ` · ${c.procedures.length} procedures` : ''}
          {c.core?.total ? ` · core ${c.core.done}/${c.core.total}` : ''}
        </span>
      </span>
      <Icon name="chevron" size={16} className="muted" />
    </a>
  );
}

function NewCaseSheet({ onClose, onCreated, defaultGroup }: { onClose: () => void; onCreated: (id: string) => void; defaultGroup: string }) {
  const { groups, cases, toast, refreshCases, upsertCase } = useStore();
  const { me } = useAuth();
  const online = useOnline();
  const [mrn, setMrn] = useState('');
  const [group, setGroup] = useState(defaultGroup);
  const [date, setDate] = useState(todayISO());
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<{ message: string; here: { case_id: string; group_seq: number; episode_start_date: string | null; collection_status: string; procedures: ProcedureSummary[] }[] } | null>(null);
  const check = mrn ? checkMrn(mrn, mrnRules) : null;

  // L3: without connection the case is made on this device; the MRN is checked against the cases kept here.
  const offline = async (newCase: boolean) => {
    const live = cases.filter((c) => c.mrn === check!.value);
    const here = live.filter((c) => c.group_id === group);
    if (live.length && !newCase) {
      const elsewhere = live.length > here.length;
      setExisting({
        message: here.length ? `This MRN already has ${here.length} case${here.length > 1 ? 's' : ''} in this group on this device.${elsewhere ? ' It is also registered in another group.' : ''}` : 'This MRN is already registered in another group.',
        here: here.map((c) => ({ case_id: c.case_id, group_seq: c.group_seq, episode_start_date: c.episode_start_date, collection_status: c.collection_status, procedures: c.procedures })),
      });
      setBusy(false);
      return;
    }
    const d = await makeOfflineCase({ mrn: check!.value!, groupId: group, groupName: groups.find((g) => g.group_id === group)?.name ?? '', date, me: { id: me!.id, name: me!.name } });
    upsertCase(d.summary);
    toast({ message: 'No connection: the case is saved on this device. Its number comes when it reaches the Google Sheet.', kind: 'info' });
    onCreated(d.meta.case_id);
  };

  const submit = async (newCase = false) => {
    if (!check?.ok) return setErr({ field: 'mrn', message: check?.error ?? 'Enter the MRN.' });
    setBusy(true);
    setErr(null);
    if (!online) return offline(newCase);
    try {
      const r = await api<{ case_id: string; group_seq: number; warning: string | null; case_of_mrn: number | null; copied: number; copied_from: string | null }>('POST', '/api/cases', {
        mrn,
        group_id: group,
        episode_start_date: date,
        ...(newCase ? { new_case: true } : {}),
      });
      await refreshCases();
      toast({
        message: `Case No. ${r.group_seq} created${r.case_of_mrn ? ` — case ${r.case_of_mrn} for this MRN` : ''}${r.copied ? `; ${r.copied} history value${r.copied === 1 ? '' : 's'} copied` : ''}`,
        kind: 'success',
      });
      onCreated(r.case_id);
    } catch (e) {
      const a = e as ApiError;
      if (a.status === 0) return offline(newCase);
      // MRN prompt (EP Workspace): the MRN already has cases; show them, then the user decides.
      if (a.code === 'MRN_HAS_CASES') setExisting({ message: a.message, here: (a.details as { here: NonNullable<typeof existing>['here'] }).here });
      else setErr({ field: a.field, message: a.message });
      setBusy(false);
    }
  };

  return (
    <Sheet title="New Case" onClose={onClose} onDone={() => submit(!!existing)} doneLabel="Create" doneDisabled={busy} testId="new-case-sheet">
      <div className="group">
        <div className="frow inline">
          <label className="lab-wrap" htmlFor="new-mrn">
            <span className="lab">MRN <span className="req">*</span></span>
          </label>
          <input
            id="new-mrn"
            className="ios-value"
            inputMode="numeric"
            autoComplete="off"
            placeholder="7 digits"
            value={mrn}
            onChange={(e) => {
              setMrn(e.target.value);
              setExisting(null);
            }}
            autoFocus
          />
        </div>
        {groups.length > 1 && (
          <div className="frow stack">
            <span className="lab">Group</span>
            <div className="mini-seg" role="radiogroup" aria-label="Group">
              {groups.map((g) => (
                <button key={g.group_id} type="button" role="radio" aria-checked={group === g.group_id} className={group === g.group_id ? 'on' : ''} onClick={() => setGroup(g.group_id)}>
                  {g.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="frow inline">
          <label className="lab-wrap" htmlFor="new-date">
            <span className="lab">Episode start date <span className="req">*</span></span>
          </label>
          <input id="new-date" className="ios-value" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      {check && !check.ok && mrn.length >= 7 && <p className="field-error">{check.error}</p>}
      {check?.ok && check.warning && <p className="warn-text small">{check.warning}</p>}
      {err && (
        <p className="field-error" role="alert">
          {err.message}
        </p>
      )}
      {existing ? (
        <div className="mrn-prompt" role="alert" data-testid="mrn-prompt">
          <p>
            <b>{existing.message}</b>
          </p>
          {existing.here.some((c) => c.episode_start_date === date) && (
            <p className="warn-text" data-testid="duplicate-warning">
              Possible duplicate: No. {existing.here.filter((c) => c.episode_start_date === date).map((c) => c.group_seq).join(', ')} has the same MRN and the same episode date. Open it instead of adding a new case, unless this really is a second episode that day.
            </p>
          )}
          {existing.here.length > 0 && (
            <div className="group">
              {existing.here.map((c) => (
                <a key={c.case_id} className="grow-row" href={`#/cases/${c.case_id}`} onClick={onClose}>
                  <span className="grow">
                    <span className="line1">
                      {seqText(c.group_seq)} · {c.episode_start_date ? fmtDate(c.episode_start_date) : 'No date'}
                    </span>
                    <span className="sub">
                      {c.procedures.map((p) => procedureChip(p).text).join(' · ') || 'No procedures'} · {c.collection_status === 'COMPLETED' ? 'Completed' : 'In progress'}
                    </span>
                  </span>
                  <Icon name="chevron" size={16} className="muted" />
                </a>
              ))}
            </div>
          )}
          <p className="muted small">Open the case above to add a procedure to the same episode, or add a new case (a new episode). Patient history is copied from the latest case and marked "Copied" to check.</p>
          <button className="btn primary block" onClick={() => submit(true)} disabled={busy}>
            {busy ? 'Creating…' : 'Add a new case for this MRN'}
          </button>
        </div>
      ) : (
        <>
          <p className="muted small">A case is one episode of care. Add each procedure of the episode inside the case.</p>
          {!online && (
            <p className="warn-text small" data-testid="offline-new-case">
              No connection: the case is saved on this device and gets its number (No.) when it reaches the Google Sheet. The MRN is checked against the cases on this device only; history from an earlier case of this MRN is copied when it reaches the Sheet.
            </p>
          )}
          <button className="btn primary block" onClick={() => submit()} disabled={busy}>
            {busy ? 'Creating…' : 'Create case'}
          </button>
        </>
      )}
    </Sheet>
  );
}

export function CasesView({ selectedId, nav }: { selectedId?: string; nav: (p: string) => void }) {
  const { cases, groups, loadError, refreshCases, toast } = useStore();
  const { can, me } = useAuth();
  const wide = useMediaQuery('(min-width: 960px)');
  const f = useFilters();
  const tagged = useTagged(cases);
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [addGroup, setAddGroup] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [period, setPeriod] = useState(false);
  const [exporting, setExporting] = useState(false);
  const activeGroup = f.grp === 'ALL' || groups.some((g) => g.group_id === f.grp) ? f.grp : 'ALL';
  const pickGroup = (g: string) => setFilters({ grp: g });
  const filtering = !!(f.proc.length || f.group.length || f.from || f.to);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return applyFilters(cases, tagged, { ...f, grp: activeGroup })
      .filter((c) => !term || matchesSearch(c, term, tagged.get(c.case_id)!))
      .sort((a, b) => (b.episode_start_date ?? '').localeCompare(a.episode_start_date ?? '') || b.group_seq - a.group_seq);
  }, [cases, tagged, f, activeGroup, q]);

  const exportFiltered = async () => {
    setExporting(true);
    try {
      toast({ message: `Downloaded ${await downloadXlsx({ scope: 'CASES', case_ids: filtered.map((c) => c.case_id) })}`, kind: 'success' });
    } catch (e) {
      toast({ message: (e as ApiError).message, kind: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const months = useMemo(() => {
    const out: { key: string; items: CaseSummary[] }[] = [];
    for (const c of filtered) {
      const k = c.episode_start_date ? monthKey(c.episode_start_date) : 'none';
      if (!out.length || out[out.length - 1].key !== k) out.push({ key: k, items: [] });
      out[out.length - 1].items.push(c);
    }
    return out;
  }, [filtered]);

  const gname = (id: string) => groups.find((g) => g.group_id === id)?.name ?? '';
  const countIn = (id: string) => cases.filter((c) => c.group_id === id).length;

  return (
    <section className="view" aria-label="Registry Cases">
      <div className="navbar">
        {!wide && (
          <button className="menu-btn" onClick={() => setDrawer(true)} data-testid="open-categories">
            <Icon name="menu" size={20} />
            <span>Categories</span>
            {filtering && <span className="menu-dot" aria-label="filters on" />}
          </button>
        )}
        <span className="grow" />
        {/* On desktop the sidebar footer shows it (owner, 28 Oct: "Synced" once). */}
        {!wide && <SaveIndicator />}
        {me?.features?.followup_bell && <FollowupBell />}
        {can('case.import') && (
          <button className="icon-btn accent" aria-label="Bulk add MRNs" title="Bulk add MRNs" onClick={() => setBulk(true)} data-testid="bulk-add" disabled={!groups.length}>
            <Icon name="list" size={24} />
          </button>
        )}
        {can('case.create') && (
          <button className="icon-btn accent" aria-label="New case" onClick={() => setShowNew(true)} data-testid="new-case" disabled={!groups.length}>
            <Icon name="plus" size={26} />
          </button>
        )}
      </div>
      <h1 className="large-title list-title">Registry Cases</h1>
      <div className="search">
        <Icon name="search" size={18} />
        <input type="search" placeholder="Search MRN or procedure" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search MRN or procedure" />
      </div>
      {(groups.length > 1 || can('groups.manage')) && (
        <div className="seg" role="radiogroup" aria-label="Group">
          <button type="button" role="radio" aria-checked={activeGroup === 'ALL'} className={activeGroup === 'ALL' ? 'on' : ''} onClick={() => pickGroup('ALL')}>
            All
          </button>
          {groups.map((g) => (
            <button key={g.group_id} type="button" role="radio" aria-checked={activeGroup === g.group_id} className={activeGroup === g.group_id ? 'on' : ''} onClick={() => pickGroup(g.group_id)}>
              {g.name} <small>{countIn(g.group_id)}</small>
            </button>
          ))}
          {can('groups.manage') && (
            <button type="button" className="plus" aria-label="Add group" onClick={() => setAddGroup(true)} data-testid="add-group">
              +
            </button>
          )}
        </div>
      )}
      <div className="filter-bar" data-testid="filter-bar">
        {(['proc', 'group'] as const).flatMap((side) =>
          f[side].map((id) => (
            <span key={id} className="chip c-cat filter-chip" style={{ '--chip': `var(--${itemColor(id)})` } as CSSProperties}>
              {itemLabel(id)}
              <button type="button" aria-label={`Remove ${itemLabel(id)}`} onClick={() => toggleFilter(side, id)}>
                <Icon name="close" size={12} />
              </button>
            </span>
          )),
        )}
        <button type="button" className="chip c-neutral filter-chip" onClick={() => setPeriod(true)} data-testid="period">
          <Icon name="cal" size={12} /> {f.from || f.to ? `${f.from ? fmtDate(f.from) : '…'} – ${f.to ? fmtDate(f.to) : '…'}` : 'Any date'}
        </button>
        {filtering && (
          <button type="button" className="link small" onClick={clearFilters}>
            Clear
          </button>
        )}
      </div>
      {drawer && (
        <SideDrawer title="Categories" onClose={() => setDrawer(false)} testId="category-drawer">
          <CategoryTree cases={cases} onCustomPeriod={() => setPeriod(true)} />
        </SideDrawer>
      )}
      {period && <PeriodSheet onClose={() => setPeriod(false)} />}
      {bulk && <BulkAddSheet defaultGroup={activeGroup !== 'ALL' ? activeGroup : groups[0]?.group_id} onClose={() => setBulk(false)} />}
      {addGroup && (
        <GroupNameDialog
          onClose={() => setAddGroup(false)}
          onSaved={(id) => {
            setAddGroup(false);
            if (id) pickGroup(id);
          }}
        />
      )}

      {loadError && (
        <div className="notice-err" role="alert">
          {loadError}{' '}
          <button className="link strong" onClick={refreshCases}>
            Try again
          </button>
        </div>
      )}

      {!groups.length ? (
        <Empty icon="patients" title="You are not in a group yet">
          <p>Ask the Admin to add you to a group. Cases belong to groups.</p>
        </Empty>
      ) : cases.length === 0 ? (
        <Empty icon="cases" title="No cases yet">
          <p>A case is one episode of care. Create it with the MRN, then add its procedures.</p>
          {can('case.create') && (
            <button className="btn primary" onClick={() => setShowNew(true)}>
              <Icon name="plus" size={18} /> New case
            </button>
          )}
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty icon="search" title="No matching cases">
          <p>{filtering ? 'No case matches these filters.' : 'Try another MRN or group.'}</p>
          {filtering && (
            <button className="btn" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </Empty>
      ) : (
        <>
          <p className="muted small count-line" data-testid="case-count">
            {filtered.length} case{filtered.length === 1 ? '' : 's'}
            {filtering && can('export.group') && (
              <button type="button" className="link small export-link" onClick={exportFiltered} disabled={exporting} data-testid="export-filtered">
                <Icon name="download" size={14} /> {exporting ? 'Preparing…' : `Export these ${filtered.length} to Excel`}
              </button>
            )}
          </p>
          {months.map((m) => (
            <div key={m.key}>
              <h2 className="monthhead">
                {m.key === 'none' ? 'No episode date' : fmtMonthKey(m.key)}
                <span className="month-count" aria-label={`${m.items.length} case${m.items.length === 1 ? '' : 's'}`}>
                  {m.items.length}
                </span>
              </h2>
              <div className="group">
                {m.items.map((c) => (
                  <CaseRow key={c.case_id} c={c} selected={c.case_id === selectedId} showGroup={activeGroup === 'ALL' && groups.length > 1 ? gname(c.group_id) : undefined} />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
      {showNew && (
        <NewCaseSheet
          defaultGroup={activeGroup !== 'ALL' ? activeGroup : groups[0]?.group_id}
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            nav(`cases/${id}`);
          }}
        />
      )}
    </section>
  );
}
