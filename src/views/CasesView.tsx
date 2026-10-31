// Cases list (approved EP Log-style preview): group switcher, search, cases grouped by month of the episode start,
// each row = date · MRN · age/sex, a chip per procedure, then No. · status.
import { useMemo, useState, type CSSProperties } from 'react';
import type { CaseSummary, ProcedureSummary } from '../../shared/caseTypes.ts';
import { checkMrn } from '../../shared/mrn.ts';
import { devicePathway, deviceTypeOf, type Pathway } from '../../shared/pathway.ts';
import { label, mrnRules } from '../lib/dict';
import { api, ApiError } from '../lib/api';
import { ageSex, fmtDate, fmtMonthKey, monthKey, todayISO } from '../lib/util';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { Icon } from '../components/Icon';
import { Empty, SaveIndicator, Sheet, useMediaQuery } from '../components/ui';
import { CategoryTree } from '../components/CategoryTree';
import { applyFilters, clearFilters, componentColor, groupColor, itemColor, itemLabel, setFilters, toggleFilter, useFilters, useTagged, type Filters } from '../lib/filters';
import { periodPresets } from '../components/CategoryTree';
import { hijriLabel } from '../lib/hijri';
import { PeriodSheet } from '../components/PeriodSheet';
import { SideDrawer } from '../components/SideDrawer';
import { downloadXlsx } from '../lib/exportFile';
import { makeOfflineCase, seqText } from '../lib/offlineCase';
import { sync, useOnline } from '../lib/sync';
import { BulkAddSheet } from './BulkAdd';
import { UserLink } from '../components/UserLink';
import { pickGroup as startGroup } from '../lib/prefs';

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

/** ICD / Pacemaker / Leads only (owner Q-P1, 31 Oct): shown next to a device case's procedure; nothing stored. */
export function PathwayTag({ pathway }: { pathway: Pathway | null }) {
  return pathway ? (
    <span className="chip pw-tag" data-testid="pathway-tag">
      {pathway}
    </span>
  ) : null;
}
export const pathwayOf = (c: CaseSummary) => devicePathway(deviceTypeOf(c.codes), c.procedures);

/** Core fields still empty (and not marked Not available). */
export const missingOf = (c: CaseSummary) => (c.core?.total ? c.core.total - c.core.done : 0);

/** Hajj or Umrah, from the recorded pilgrim status. */
export function pilgrimMark(c: CaseSummary): string | null {
  const codes = c.codes ?? [];
  return codes.includes('EP_EPISODES.pilgrim_status=HAJJ') ? 'Hajj' : codes.includes('EP_EPISODES.pilgrim_status=UMRAH') ? 'Umrah' : null;
}

export function CaseRow({ c, selected, showGroup, groupDot }: { c: CaseSummary; selected?: boolean; showGroup?: string; groupDot?: string }) {
  const as = ageSex(c.age, c.sex);
  const hajj = pilgrimMark(c);
  const missing = c.collection_status === 'COMPLETED' ? 0 : missingOf(c);
  return (
    <a href={`#/cases/${c.case_id}`} className={`grow-row case-row${selected ? ' sel' : ''}`} data-testid="case-row" aria-current={selected ? 'true' : undefined}>
      <span className="grow">
        <span className="line1 card-top">
          <b className="card-mrn">{c.mrn}</b>
          {as && <span className="muted card-as">{as}</span>}
          {hajj && <span className="chip c-cat hajj-mark" style={{ '--chip': 'var(--cat-pilgrim)' } as CSSProperties}>{hajj}</span>}
          <span className="card-date muted">{c.episode_start_date ? fmtDate(c.episode_start_date) : 'No date'}</span>
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
          ) : c.planned_type ? (
            <span className="chip c-neutral planned" data-testid="planned-chip">
              {label('PROCEDURE_COMPONENTS', 'component_type', c.planned_type)} (planned)
            </span>
          ) : (
            <span className="chip c-neutral">MRN only</span>
          )}
          <PathwayTag pathway={pathwayOf(c)} />
        </span>
        <span className="sub">
          {groupDot && <span className="gdot" style={{ background: `var(--${groupDot})` }} aria-hidden />}
          {showGroup ? `${showGroup} · ` : ''}{seqText(c.group_seq)} · {sync.isLocalOnly(c.case_id) && <span className="chip c-neutral" data-testid="device-only">On this device only</span>} <span className={`status ${c.collection_status === 'COMPLETED' ? 's-done' : 's-prog'}`}>{c.collection_status === 'COMPLETED' ? 'Completed' : 'In progress'}</span>
          {c.procedures.length > 1 ? ` · ${c.procedures.length} procedures` : ''}
          {missing > 0 && (
            <>
              {' · '}
              <span className="missing" title={`Core fields: ${c.core.done} of ${c.core.total} done`}>
                {missing} missing
              </span>
            </>
          )}
        </span>
      </span>
      <Icon name="chevron" size={16} className="muted" />
    </a>
  );
}

export function NewCaseSheet({ onClose, onCreated, defaultGroup }: { onClose: () => void; onCreated: (id: string) => void; defaultGroup: string }) {
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
    const d = await makeOfflineCase({ mrn: check!.value!, groupId: group, groupName: groups.find((g) => g.group_id === group)?.name ?? '', date, me: { id: me!.id, name: me!.name }, knownCaseIds: live.map((c) => c.case_id) });
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

  // Live check while typing (owner, 28 Oct): earlier cases of this MRN among the cases this user can see.
  const earlier = check?.ok ? cases.filter((c) => c.mrn === check.value).sort((a, b) => (b.episode_start_date ?? '').localeCompare(a.episode_start_date ?? '')) : [];
  const hijri = hijriLabel(date);
  const prompt = existing ? [...existing.here].sort((a, b) => (b.episode_start_date ?? '').localeCompare(a.episode_start_date ?? '')) : [];

  return (
    <Sheet title="New Case" onClose={onClose} testId="new-case-sheet">
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
          {check?.ok && !existing && (
            <div className={`frow-err small ${earlier.length ? 'warn-text' : 'ok-text'}`} data-testid="mrn-live">
              {earlier.length
                ? `This MRN has ${earlier.length} case${earlier.length === 1 ? '' : 's'}: last ${earlier[0].episode_start_date ? fmtDate(earlier[0].episode_start_date) : 'with no date'}`
                : '✓ New patient: no earlier case with this MRN'}
            </div>
          )}
          {!online && check?.ok && !existing && (
            <div className="frow-err small muted" data-testid="mrn-offline">
              Offline: checked against cases on this device only.
            </div>
          )}
        </div>
        {groups.length > 1 && (
          <div className="frow stack">
            <span className="lab">Group</span>
            <div className="pill-set group-pills" role="radiogroup" aria-label="Group">
              {groups.map((g) => (
                <button key={g.group_id} type="button" role="radio" aria-checked={group === g.group_id} className={group === g.group_id ? 'on' : ''} onClick={() => setGroup(g.group_id)}>
                  <span className="gdot" style={{ background: `var(--${groupColor(groups, g.group_id)})` }} aria-hidden />
                  {g.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="frow inline">
          <label className="lab-wrap" htmlFor="new-date">
            <span className="lab">Procedure date <span className="req">*</span></span>
          </label>
          <input id="new-date" className="ios-value" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
          {hijri && <div className="frow-err muted small hijri-line">{hijri}</div>}
        </div>
      </div>
      {check && !check.ok && mrn.length >= 7 && <p className="field-error">{check.error}</p>}
      {err && (
        <p className="field-error" role="alert">
          {err.message}
        </p>
      )}
      {existing ? (
        <div className="mrn-prompt" role="alert" data-testid="mrn-prompt">
          <p>
            <b>{prompt.length ? `This patient already has ${prompt.length} case${prompt.length === 1 ? '' : 's'}` : existing.message}</b>
          </p>
          {existing.here.some((c) => c.episode_start_date === date) && (
            <p className="warn-text" data-testid="duplicate-warning">
              Possible duplicate: No. {existing.here.filter((c) => c.episode_start_date === date).map((c) => c.group_seq).join(', ')} has the same MRN and the same episode date. Open it instead of adding a new case, unless this really is a second episode that day.
            </p>
          )}
          {prompt.length > 0 && (
            <div className="group">
              {prompt.map((c) => (
                <a key={c.case_id} className="grow-row prompt-case" href={`#/cases/${c.case_id}`} onClick={onClose}>
                  <span className="grow">
                    <span className="line1 proc-top">
                      <b>{c.episode_start_date ? fmtDate(c.episode_start_date) : 'No date'}</b>
                      <span className={`status ${c.collection_status === 'COMPLETED' ? 's-done' : 's-prog'}`}>{c.collection_status === 'COMPLETED' ? 'Completed' : 'In progress'}</span>
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
                        <span className="chip c-neutral">No procedures</span>
                      )}
                    </span>
                    <span className="sub">
                      {groups.find((g) => g.group_id === group)?.name} · {seqText(c.group_seq)}
                    </span>
                  </span>
                  <Icon name="chevron" size={16} className="muted" />
                </a>
              ))}
            </div>
          )}
          {prompt.length > 0 && (
            <a className="btn block wide-btn open-case" href={`#/cases/${prompt[0].case_id}`} onClick={onClose} data-testid="open-earlier">
              Open this case
            </a>
          )}
          <p className="muted small">A new case copies the patient's history and marks it "Copied" until you check it. Procedures are never copied.</p>
          <button className="btn primary block wide-btn" onClick={() => submit(true)} disabled={busy}>
            {busy ? 'Creating…' : 'New case for this patient'}
          </button>
        </div>
      ) : (
        <>
          {!online && (
            <p className="warn-text small" data-testid="offline-new-case">
              No connection: the case is saved on this device and gets its number (No.) when it reaches the Google Sheet. History from an earlier case of this MRN is copied when it reaches the Sheet.
            </p>
          )}
          <button className="btn primary block wide-btn" onClick={() => submit()} disabled={busy}>
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
  const [bulk, setBulk] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [period, setPeriod] = useState(false);
  const [exporting, setExporting] = useState(false);
  const activeGroup = f.grp === 'ALL' || groups.some((g) => g.group_id === f.grp) ? f.grp : 'ALL';
  const pickGroup = (g: string) => setFilters({ grp: g });
  const status = f.status ?? 'ALL';
  const sort = f.sort ?? 'NEW';
  const filtering = !!(f.proc.length || f.group.length || f.from || f.to || status !== 'ALL');
  const [addMenu, setAddMenu] = useState(false);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const newest = (a: CaseSummary, b: CaseSummary) => (b.episode_start_date ?? '').localeCompare(a.episode_start_date ?? '') || b.group_seq - a.group_seq;
    const order =
      sort === 'OLD' ? (a: CaseSummary, b: CaseSummary) => -newest(a, b) : sort === 'MISSING' ? (a: CaseSummary, b: CaseSummary) => missingOf(b) - missingOf(a) || newest(a, b) : newest;
    return applyFilters(cases, tagged, { ...f, grp: activeGroup })
      .filter((c) => status === 'ALL' || c.collection_status === status)
      .filter((c) => !term || matchesSearch(c, term, tagged.get(c.case_id)!))
      .sort(order);
  }, [cases, tagged, f, activeGroup, q, status, sort]);

  // Owner, step 5: no Patients tab; an MRN typed in search offers that patient's page.
  const patientHits = useMemo(() => {
    const term = q.trim();
    if (!/^\d{3,}$/.test(term)) return [];
    const m = new Map<string, number>();
    for (const c of cases) if (c.mrn.includes(term)) m.set(c.mrn, (m.get(c.mrn) ?? 0) + 1);
    return [...m.entries()].slice(0, 3);
  }, [cases, q]);

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
      const k = sort === 'MISSING' ? 'missing' : c.episode_start_date ? monthKey(c.episode_start_date) : 'none';
      if (!out.length || out[out.length - 1].key !== k) out.push({ key: k, items: [] });
      out[out.length - 1].items.push(c);
    }
    return out;
  }, [filtered, sort]);

  const gname = (id: string) => groups.find((g) => g.group_id === id)?.name ?? '';
  // Quick periods next to the date button (owner, 28 Oct).
  const quick = useMemo(() => periodPresets().filter(([t]) => t === 'This month' || t === 'Last 3 months' || t.startsWith('Hajj season')), []);
  const custom = !!(f.from || f.to) && !quick.some(([, a, b]) => f.from === a && f.to === b);
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
        {wide && can('case.create') && (
          <button className="icon-btn accent" aria-label="Add cases" onClick={() => setAddMenu(true)} data-testid="add-menu" disabled={!groups.length}>
            <Icon name="plus" size={26} />
          </button>
        )}
      </div>
      {/* Owner, 28 Oct: on phones + is a big floating button (one hand); it opens New case / Bulk add. Admin only. */}
      {!wide && can('case.create') && (
        <button className="fab" aria-label="Add cases" onClick={() => setAddMenu(true)} data-testid="add-menu" disabled={!groups.length}>
          <Icon name="plus" size={28} />
        </button>
      )}
      {addMenu && (
        <Sheet title="Add" onClose={() => setAddMenu(false)} testId="add-sheet">
          <div className="group">
            <button
              type="button"
              className="grow-row add-choice"
              data-testid="new-case"
              onClick={() => {
                setAddMenu(false);
                setShowNew(true);
              }}
            >
              <Icon name="plus" size={20} />
              <span className="grow">
                <span className="line1">New case</span>
                <span className="sub">One patient, with the MRN</span>
              </span>
            </button>
            {can('case.import') && (
              <button
                type="button"
                className="grow-row add-choice"
                data-testid="bulk-add"
                onClick={() => {
                  setAddMenu(false);
                  setBulk(true);
                }}
              >
                <Icon name="list" size={20} />
                <span className="grow">
                  <span className="line1">Bulk add MRNs</span>
                  <span className="sub">A list of MRNs, copied from Excel</span>
                </span>
              </button>
            )}
          </div>
        </Sheet>
      )}
      <h1 className="large-title list-title">Registry Cases</h1>
      <div className="search">
        <Icon name="search" size={18} />
        <input type="search" placeholder="Search MRN or procedure" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search MRN or procedure" />
      </div>
      {patientHits.length > 0 && (
        <div className="group patient-hits">
          {patientHits.map(([mrn, n]) => (
            <a key={mrn} href={`#/patients/${encodeURIComponent(mrn)}`} className="grow-row" data-testid="patient-hit">
              <span className="row-ic">
                <Icon name="user" size={18} />
              </span>
              <span className="grow">
                <span className="line1">
                  Patient <b>{mrn}</b> · {n} case{n === 1 ? '' : 's'}
                </span>
              </span>
              <Icon name="chevron" size={16} className="muted" />
            </a>
          ))}
        </div>
      )}
      {/* One group: no tabs. Adding a group is in Settings (owner, 28 Oct). */}
      {groups.length > 1 && (
        <div className="seg" role="radiogroup" aria-label="Group">
          <button type="button" role="radio" aria-checked={activeGroup === 'ALL'} className={activeGroup === 'ALL' ? 'on' : ''} onClick={() => pickGroup('ALL')}>
            All
          </button>
          {groups.map((g) => (
            <button key={g.group_id} type="button" role="radio" aria-checked={activeGroup === g.group_id} className={activeGroup === g.group_id ? 'on' : ''} onClick={() => pickGroup(g.group_id)}>
              <span className="gdot" style={{ background: `var(--${groupColor(groups, g.group_id)})` }} aria-hidden />
              {g.name} <small>{countIn(g.group_id)}</small>
            </button>
          ))}
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
        {quick.map(([text, a, b]) => {
          const on = f.from === a && f.to === b;
          return (
            <button key={text} type="button" className={`chip filter-chip quick${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setFilters(on ? { from: null, to: null } : { from: a, to: b })}>
              {text}
            </button>
          );
        })}
        <button type="button" className={`chip filter-chip quick${custom ? ' on' : ''}`} onClick={() => setPeriod(true)} data-testid="period">
          <Icon name="cal" size={12} /> {custom ? `${f.from ? fmtDate(f.from) : '…'} – ${f.to ? fmtDate(f.to) : '…'}` : 'Any date'}
        </button>
        <label className="chip c-neutral filter-chip select-chip">
          <select value={status} onChange={(e) => setFilters({ status: e.target.value as Filters['status'] })} aria-label="Status" data-testid="status-filter">
            <option value="ALL">All statuses</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </label>
        <label className="chip c-neutral filter-chip select-chip">
          <select value={sort} onChange={(e) => setFilters({ sort: e.target.value as Filters['sort'] })} aria-label="Order" data-testid="sort">
            <option value="NEW">Newest first</option>
            <option value="OLD">Oldest first</option>
            <option value="MISSING">Most missing first</option>
          </select>
        </label>
        {filtering && (
          <button type="button" className="link small" onClick={clearFilters}>
            Clear
          </button>
        )}
      </div>
      {drawer && (
        <SideDrawer title="Categories" onClose={() => setDrawer(false)} testId="category-drawer">
          <CategoryTree cases={cases} onCustomPeriod={() => setPeriod(true)} />
          <div className="drawer-foot">
            <UserLink onClick={() => setDrawer(false)} />
          </div>
        </SideDrawer>
      )}
      {period && <PeriodSheet onClose={() => setPeriod(false)} />}
      {bulk && <BulkAddSheet defaultGroup={startGroup(me?.id, groups, activeGroup)} onClose={() => setBulk(false)} />}

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
                {m.key === 'missing' ? 'Most missing first' : m.key === 'none' ? 'No episode date' : fmtMonthKey(m.key)}
                <span className="month-count" aria-label={`${m.items.length} case${m.items.length === 1 ? '' : 's'}`}>
                  {m.items.length}
                </span>
              </h2>
              <div className="group">
                {m.items.map((c) => (
                  <CaseRow
                    key={c.case_id}
                    c={c}
                    selected={c.case_id === selectedId}
                    showGroup={activeGroup === 'ALL' && groups.length > 1 ? gname(c.group_id) : undefined}
                    groupDot={activeGroup === 'ALL' && groups.length > 1 ? groupColor(groups, c.group_id) : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
      {showNew && (
        <NewCaseSheet
          defaultGroup={startGroup(me?.id, groups, activeGroup)}
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
