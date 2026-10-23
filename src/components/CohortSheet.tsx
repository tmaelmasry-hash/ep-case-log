// New / edit cohort (owner R2-12, approved preview): by rule (conditions on dictionary fields, All or Any; cases join
// on their own) or by tag (the Admin adds cases from inside each case). Admin only; the server checks everything again.
import { useEffect, useMemo, useState } from 'react';
import { COHORT_COLORS, checkCohort, opsFor, ruleFields, type CohortCondition, type CohortDef, type CohortOp } from '../../shared/cohorts.ts';
import { codeLabel } from '../../shared/dictionary.ts';
import { api, ApiError } from '../lib/api';
import { refreshCohorts } from '../lib/cohorts';
import { dict } from '../lib/dict';
import { useStore } from '../store';
import { Icon } from './Icon';
import { Confirm, Sheet } from './ui';

const OP_LABEL: Record<CohortOp, string> = {
  in: 'is any of',
  has: 'has a value',
  empty: 'is empty',
  yes: 'is Yes',
  no: 'is No',
  lt: 'less than',
  gt: 'more than',
  between: 'between',
  before: 'before',
  after: 'after',
};

const FIELDS = ruleFields(dict);
const fieldOf = (path: string) => FIELDS.find((x) => x.path === path);

function ConditionRow({ c, onChange, onRemove }: { c: CohortCondition; onChange: (c: CohortCondition) => void; onRemove: () => void }) {
  const fd = fieldOf(c.field)!;
  const v = c.values ?? [];
  const isDate = fd.f.type === 'date' || fd.f.type === 'datetime';
  const set = (i: number, x: string) => {
    const next = [...v];
    next[i] = isDate ? x : x === '' ? '' : Number(x);
    onChange({ ...c, values: next });
  };
  return (
    <div className="cohort-cond" data-testid="cohort-condition">
      <div className="cond-head">
        <span className="muted small">{fd.label}</span>
        <button type="button" className="link small danger-text" aria-label="Remove condition" onClick={onRemove}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <select className="ios-value" aria-label="Comparison" value={c.op} onChange={(e) => onChange({ field: c.field, op: e.target.value as CohortOp, values: [] })}>
        {opsFor(fd.f).map((o) => (
          <option key={o} value={o}>
            {OP_LABEL[o]}
          </option>
        ))}
      </select>
      {c.op === 'in' && (
        <div className="pill-set">
          {(fd.f.codes ?? []).map((k) => {
            const on = v.includes(k.code);
            return (
              <button key={k.code} type="button" className={`pill${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onChange({ ...c, values: on ? v.filter((x) => x !== k.code) : [...v, k.code] })}>
                {codeLabel(fd.f, k.code)}
              </button>
            );
          })}
        </div>
      )}
      {(c.op === 'lt' || c.op === 'gt' || c.op === 'before' || c.op === 'after' || c.op === 'between') && (
        <div className="cond-vals">
          <input className="ios-value" aria-label="Value" type={isDate ? 'date' : 'number'} inputMode="decimal" value={String(v[0] ?? '')} onChange={(e) => set(0, e.target.value)} />
          {c.op === 'between' && (
            <>
              <span className="muted small">and</span>
              <input className="ios-value" aria-label="Second value" type={isDate ? 'date' : 'number'} inputMode="decimal" value={String(v[1] ?? '')} onChange={(e) => set(1, e.target.value)} />
            </>
          )}
          {fd.f.unit && <span className="muted small">{fd.f.unit}</span>}
        </div>
      )}
    </div>
  );
}

export function CohortSheet({ cohort, onClose }: { cohort?: CohortDef; onClose: () => void }) {
  const { toast, refreshCases } = useStore();
  const [name, setName] = useState(cohort?.name ?? '');
  const [kind, setKind] = useState<'rule' | 'tag'>(cohort?.kind ?? 'rule');
  const [color, setColor] = useState(cohort?.color ?? COHORT_COLORS[0]);
  const [note, setNote] = useState(cohort?.note ?? '');
  const [match, setMatch] = useState<'ALL' | 'ANY'>(cohort?.match ?? 'ALL');
  const [conds, setConds] = useState<CohortCondition[]>(cohort?.conditions ?? []);
  const [q, setQ] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const found = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t.length < 2 ? [] : FIELDS.filter((x) => x.label.toLowerCase().includes(t)).slice(0, 30);
  }, [q]);
  const draft = { name, kind, match, conditions: conds };
  const problem = checkCohort(dict, draft);

  useEffect(() => {
    setCount(null);
    if (kind !== 'rule' || checkCohort(dict, { ...draft, name: 'x' })) return;
    const t = window.setTimeout(() => {
      api<{ count: number }>('POST', '/api/cohorts/preview', { match, conditions: conds })
        .then((r) => setCount(r.count))
        .catch(() => setCount(null));
    }, 500);
    return () => window.clearTimeout(t);
  }, [kind, match, JSON.stringify(conds)]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (problem) return setErr(problem);
    setBusy(true);
    setErr('');
    try {
      const body = { name, kind, color, note, match, conditions: conds };
      await (cohort ? api('PATCH', `/api/cohorts/${cohort.id}`, body) : api('POST', '/api/cohorts', body));
      await Promise.all([refreshCohorts(), refreshCases()]);
      toast({ message: cohort ? 'Cohort saved' : `Cohort ${name} added`, kind: 'success' });
      onClose();
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    await api('POST', `/api/cohorts/${cohort!.id}/delete`);
    await Promise.all([refreshCohorts(), refreshCases()]);
    toast({ message: `Cohort ${cohort!.name} deleted`, kind: 'success' });
    onClose();
  };

  return (
    <Sheet title={cohort ? 'Edit cohort' : 'New cohort'} onClose={onClose} onDone={save} doneLabel="Save" doneDisabled={busy} testId="cohort-sheet">
      <div className="group">
        <div className="frow inline">
          <label className="lab-wrap" htmlFor="cohort-name">
            <span className="lab">Name</span>
          </label>
          <input id="cohort-name" className="ios-value" maxLength={60} placeholder="Low EF ICD" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      {!cohort && (
        <div className="seg" role="radiogroup" aria-label="Kind">
          {(['rule', 'tag'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              <Icon name={k === 'rule' ? 'filter' : 'clip'} size={14} /> {k === 'rule' ? 'By rule' : 'By tag'}
            </button>
          ))}
        </div>
      )}
      <div className="cohort-colors" role="radiogroup" aria-label="Color">
        {COHORT_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} className={`swatch${color === c ? ' on' : ''}`} style={{ background: `var(--${c})` }} onClick={() => setColor(c)} />
        ))}
      </div>

      {kind === 'rule' ? (
        <>
          <div className="seg" role="radiogroup" aria-label="Match">
            {(['ALL', 'ANY'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={match === m} className={match === m ? 'on' : ''} onClick={() => setMatch(m)}>
                {m === 'ALL' ? 'All of these' : 'Any of these'}
              </button>
            ))}
          </div>
          {conds.map((c, i) => (
            <ConditionRow key={i} c={c} onChange={(n) => setConds(conds.map((x, k) => (k === i ? n : x)))} onRemove={() => setConds(conds.filter((_, k) => k !== i))} />
          ))}
          {conds.length < 10 && (
            <div className="cohort-add">
              <div className="search">
                <Icon name="search" size={16} />
                <input type="search" placeholder="Add condition: search any field" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search fields" />
              </div>
              {found.length > 0 && (
                <div className="group field-results">
                  {found.map((x) => (
                    <button
                      key={x.path}
                      type="button"
                      className="grow-row"
                      onClick={() => {
                        setConds([...conds, { field: x.path, op: opsFor(x.f)[0], values: [] }]);
                        setQ('');
                      }}
                    >
                      <span className="grow">{x.label}</span>
                      <Icon name="plus" size={16} className="muted" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <p className="small" data-testid="cohort-count">
            {count === null ? <span className="muted">Add conditions to see how many cases match.</span> : <b>{count === 1 ? '1 case matches now' : `${count} cases match now`}</b>}
          </p>
        </>
      ) : (
        <>
          <div className="group">
            <div className="frow stack">
              <label className="lab" htmlFor="cohort-note">
                Note (optional)
              </label>
              <textarea id="cohort-note" className="ios-text" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <p className="muted small">Add cases from inside each case (Cohorts row).</p>
        </>
      )}
      {err && (
        <p className="field-error" role="alert">
          {err}
        </p>
      )}
      <button className="btn primary block" onClick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save cohort'}
      </button>
      {cohort && (
        <button className="btn danger-text block" onClick={() => setConfirmDelete(true)}>
          <Icon name="trash" size={18} /> Delete cohort
        </button>
      )}
      {confirmDelete && (
        <Confirm title={`Delete ${cohort!.name}?`} message="The cohort leaves the menu. Cases are not changed." confirmLabel="Delete" danger onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
      )}
    </Sheet>
  );
}
