import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { ROLES } from '../lib/catalog';
import type { CaseRec, Sex } from '../lib/types';
import { fmtDate, todayISO, validateCaseFields, type CaseFieldErrors } from '../lib/util';
import { Segmented, Sheet } from '../components/ui';

/** Create a case, or edit the date/patient fields of an existing one. */
export function CaseInfoSheet({ existing, onClose, onCreated }: { existing?: CaseRec; onClose: () => void; onCreated?: (id: string) => void }) {
  const { cases, createCase, updateCase, toast } = useStore();
  const [date, setDate] = useState(existing?.date ?? todayISO());
  const [mrn, setMrn] = useState(existing?.mrn ?? '');
  const [age, setAge] = useState(existing?.age != null ? String(existing.age) : '');
  const [sex, setSex] = useState<Sex>(existing?.sex ?? '');
  const [role, setRole] = useState(existing?.role ?? '');
  const [fluoro, setFluoro] = useState(existing?.fluoroMin != null ? String(existing.fluoroMin) : '');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  const errors: CaseFieldErrors = validateCaseFields({ date, mrn, age, fluoroMin: fluoro });
  const valid = Object.keys(errors).length === 0;

  const mrns = useMemo(() => [...new Set(cases.map((c) => c.mrn))].sort(), [cases]);
  const prior = useMemo(
    () => cases.filter((c) => c.mrn === mrn.trim() && c.id !== existing?.id).sort((a, b) => b.date.localeCompare(a.date))[0],
    [cases, mrn, existing],
  );

  const onMrnChange = (v: string) => {
    setMrn(v);
    const p = cases.filter((c) => c.mrn === v.trim()).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (p && !existing && !sex) setSex(p.sex);
  };

  const submit = async () => {
    setTouched(true);
    if (!valid || busy) return;
    setBusy(true);
    const patch = {
      date,
      mrn: mrn.trim(),
      age: age.trim() === '' ? null : Number(age),
      sex,
      role,
      fluoroMin: fluoro.trim() === '' ? null : Number(fluoro),
    };
    try {
      if (existing) {
        await updateCase(existing.id, patch);
        onClose();
      } else {
        const rec = await createCase(patch);
        toast({ message: 'Case created', kind: 'success' });
        onClose();
        onCreated?.(rec.id);
      }
    } catch {
      setBusy(false);
    }
  };

  const err = (k: keyof CaseFieldErrors) =>
    touched && errors[k] ? (
      <span className="field-error" role="alert">
        {errors[k]}
      </span>
    ) : null;

  return (
    <Sheet title={existing ? 'Edit Case' : 'New Case'} onClose={onClose} onDone={submit} doneLabel={existing ? 'Save' : 'Create'} testId="case-info-sheet">
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="card form-card">
          <label className="field">
            <span>
              Date <i className="req">*</i>
            </span>
            <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} aria-invalid={!!(touched && errors.date)} />
            {err('date')}
          </label>
          <label className="field">
            <span>
              MRN <i className="req">*</i>
            </span>
            <input
              value={mrn}
              list="mrn-list"
              inputMode="text"
              autoComplete="off"
              placeholder="Medical record number"
              onChange={(e) => onMrnChange(e.target.value)}
              aria-invalid={!!(touched && errors.mrn)}
              autoFocus={!existing}
            />
            <datalist id="mrn-list">
              {mrns.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {err('mrn')}
            {prior && (
              <span className="hint">
                Known patient · last case {fmtDate(prior.date)}
                {prior.age != null ? ` · age ${prior.age}` : ''}
              </span>
            )}
          </label>
          <div className="field-row">
            <label className="field">
              <span>Age</span>
              <input inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/[^\d]/g, ''))} placeholder="years" aria-invalid={!!(touched && errors.age)} />
              {err('age')}
            </label>
            <div className="field">
              <span>Sex</span>
              <Segmented label="Sex" options={['M', 'F']} value={sex} onChange={(v) => setSex(v as Sex)} />
            </div>
          </div>
          <div className="field">
            <span>Your role</span>
            <Segmented label="Your role" options={ROLES} value={role} onChange={setRole} />
          </div>
          <label className="field">
            <span>Fluoroscopy time (min)</span>
            <input inputMode="decimal" value={fluoro} onChange={(e) => setFluoro(e.target.value.replace(/[^\d.]/g, ''))} placeholder="optional" aria-invalid={!!(touched && errors.fluoroMin)} />
            {err('fluoroMin')}
          </label>
        </div>
        <p className="muted small">
          Store the minimum identifiers you need. This app keeps data on your device; follow your institution's policy for patient data.
        </p>
        <button type="submit" className="btn primary block" disabled={busy}>
          {existing ? 'Save changes' : 'Create case'}
        </button>
      </form>
    </Sheet>
  );
}
