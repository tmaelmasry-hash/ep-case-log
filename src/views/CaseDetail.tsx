import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { COMPLICATIONS, PROC_BY_TYPE, procCategory, procLabel, procSummary } from '../lib/catalog';
import { CHA_ITEMS, agePoints, caseNeedsCha, chaScore } from '../lib/cha';
import { fileToDataUrl, processFile } from '../lib/image';
import type { ChaInputs, ImageMeta, Procedure } from '../lib/types';
import { fmtDate, patientLine } from '../lib/util';
import { Icon } from '../components/Icon';
import { ChipSelect, Confirm, Empty, SaveIndicator, Sheet } from '../components/ui';
import { CaseInfoSheet } from './CaseInfoSheet';
import { CaseReport } from './CaseReport';
import { ImageEditor, ImageViewer, Thumb } from './Images';
import { ProcedurePicker, ProcedureSheet } from './ProcedureSheets';
import { ProcChip } from './CasesView';

const NO_CHA: ChaInputs = { chf: false, htn: false, diabetes: false, strokeTia: false, vascular: false };

function ChaSheet({ initial, age, sex, onSave, onClose }: { initial: ChaInputs | null; age: number | null; sex: string; onSave: (v: ChaInputs) => void; onClose: () => void }) {
  const [v, setV] = useState<ChaInputs>(initial ?? NO_CHA);
  const r = chaScore(v, age, sex as 'M' | 'F' | '');
  return (
    <Sheet title="CHA₂DS₂-VASc" onClose={onClose} onDone={() => onSave(v)} testId="cha-sheet">
      <p className="muted small">Risk factors at the time of this procedure. Age and sex come from the case.</p>
      <div className="card list">
        {CHA_ITEMS.map((it) => (
          <label key={it.key} className="row check-row">
            <input type="checkbox" checked={v[it.key]} onChange={(e) => setV({ ...v, [it.key]: e.target.checked })} />
            <span className="grow">{it.label}</span>
            <span className="muted">+{it.points}</span>
          </label>
        ))}
        <div className="row check-row derived">
          <span className="grow">Age {age ?? '— (not entered)'}</span>
          <span className="muted">+{agePoints(age)}</span>
        </div>
        <div className="row check-row derived">
          <span className="grow">Sex {sex || '— (not entered)'}</span>
          <span className="muted">+{sex === 'F' ? 1 : 0}</span>
        </div>
      </div>
      <div className="cha-result" data-testid="cha-result">
        <div>
          <span className="cha-num">{r.score}</span>
          <span>CHA₂DS₂-VASc</span>
        </div>
        <div>
          <span className="cha-num secondary">{r.vaScore}</span>
          <span>CHA₂DS₂-VA</span>
        </div>
      </div>
      {age === null && <p className="field-error">Enter the patient's age on the case for an accurate score.</p>}
      <p className="muted small">
        CHA₂DS₂-VA omits sex and is the variant recommended in the 2024 ESC AF guideline. Scores are shown for logging only, not as treatment advice.
      </p>
      <button className="btn primary block" onClick={() => onSave(v)}>
        Save score
      </button>
    </Sheet>
  );
}

/** Saves on every change: case records are small (images live separately), so nothing is lost on close. */
function NotesField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  return (
    <textarea
      className="card notes-input"
      rows={4}
      placeholder="Add notes"
      aria-label="Case notes"
      value={text}
      onFocus={() => (focused.current = true)}
      onBlur={() => (focused.current = false)}
      onChange={(e) => {
        setText(e.target.value);
        onSave(e.target.value);
      }}
    />
  );
}

export function CaseDetail({ id, nav }: { id: string; nav: (p: string) => void }) {
  const { cases, images, updateCase, deleteCase, addImages, toast } = useStore();
  const c = cases.find((x) => x.id === id);
  const [picker, setPicker] = useState(false);
  const [editProc, setEditProc] = useState<{ type: string; existing?: Procedure } | null>(null);
  const [confirmProc, setConfirmProc] = useState<Procedure | null>(null);
  const [cha, setCha] = useState(false);
  const [comp, setComp] = useState(false);
  const [info, setInfo] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [scan, setScan] = useState<{ src: string; kind: 'opnote' | 'image' } | null>(null);
  const [viewer, setViewer] = useState<ImageMeta | null>(null);
  const [printing, setPrinting] = useState(false);
  const opRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  // "#/cases/<id>/add" opens the procedure picker right after creating a case.
  useEffect(() => {
    if (window.location.hash.endsWith('/add')) {
      setPicker(true);
      history.replaceState(null, '', `#/cases/${id}`);
    }
  }, [id]);

  if (!c) {
    return (
      <section className="view">
        <Empty icon="cases" title="Case not found">
          <p>It may have been deleted.</p>
          <button className="btn" onClick={() => nav('cases')}>
            Back to cases
          </button>
        </Empty>
      </section>
    );
  }

  const caseImgs = images.filter((i) => i.caseId === c.id).sort((a, b) => a.createdAt - b.createdAt);
  const opnotes = caseImgs.filter((i) => i.kind === 'opnote');
  const pics = caseImgs.filter((i) => i.kind === 'image');
  const needsCha = caseNeedsCha(c);
  const chaRes = needsCha && c.cha ? chaScore(c.cha, c.age, c.sex) : null;

  const saveProc = async (p: Procedure) => {
    const exists = c.procedures.some((x) => x.id === p.id);
    const procedures = exists ? c.procedures.map((x) => (x.id === p.id ? p : x)) : [...c.procedures, p];
    await updateCase(c.id, { procedures });
    setEditProc(null);
    const def = PROC_BY_TYPE[p.type];
    if (!exists && def?.needsCha && !c.cha) setCha(true);
  };

  const removeProc = async (p: Procedure) => {
    const before = c.procedures;
    await updateCase(c.id, { procedures: before.filter((x) => x.id !== p.id) });
    toast({ message: `${procLabel(p)} removed`, undo: () => updateCase(c.id, { procedures: before }) });
  };

  const onPickFile = async (files: FileList | null, kind: 'opnote' | 'image') => {
    if (!files?.length) return;
    try {
      if (kind === 'opnote' || files.length === 1) {
        setScan({ src: await fileToDataUrl(files[0]), kind });
      } else {
        const out = await Promise.all([...files].map(processFile));
        await addImages(out.map((o) => ({ ...o, caseId: c.id, kind })));
        toast({ message: `${out.length} images added`, kind: 'success' });
      }
    } catch (e) {
      toast({ message: (e as Error).message, kind: 'error' });
    }
  };

  return (
    <section className="view detail" aria-label="Case detail">
      <div className="toolbar">
        <a href="#/cases" className="link back">
          <Icon name="back" size={20} /> Cases
        </a>
        <span className="grow center-title">Case</span>
        <span className="narrow-only">
          <SaveIndicator />
        </span>
        <button className="icon-btn" aria-label="Export PDF report" title="Export PDF report" onClick={() => setPrinting(true)}>
          <Icon name="doc" />
        </button>
        <button className="link strong" onClick={() => setInfo(true)}>
          Edit
        </button>
      </div>

      <div className="card head-card">
        <div className="head-top">
          <h1>{fmtDate(c.date)}</h1>
          {needsCha && (
            <div className="cha-inline">
              <span className={`cha-badge${chaRes ? '' : ' missing'}`}>CHA₂DS₂-VASc {chaRes ? chaRes.score : '?'}</span>
              <span className="muted small">at time of procedure</span>
            </div>
          )}
        </div>
        <p>
          <b>MRN: {c.mrn}</b> <span className="muted">{`${c.age ?? ''}${c.sex}`}</span>
        </p>
        <p className="muted small">
          {[c.role && `Role: ${c.role}`, c.fluoroMin != null && `Fluoro ${c.fluoroMin} min`].filter(Boolean).join(' · ')}
        </p>
        {needsCha && (
          <button className="link small" onClick={() => setCha(true)} data-testid="update-cha">
            <Icon name="refresh" size={16} /> {chaRes ? 'Update' : 'Add'} CHA₂DS₂-VASc
          </button>
        )}
      </div>

      <h2 className="section-label">Procedures</h2>
      <div className="card list">
        {c.procedures.map((p) => (
          <button key={p.id} className="row proc-row" onClick={() => setEditProc({ type: p.type, existing: p })}>
            <Icon name={PROC_BY_TYPE[p.type]?.icon ?? 'plus'} size={24} className="accent-ic" />
            <div className="row-main">
              <div className="row-title">
                <b>{procLabel(p)}</b> <ProcChip label={procCategory(p)} category={procCategory(p)} />
              </div>
              <div className="muted small">{procSummary(p) || 'No details'}</div>
            </div>
            <Icon name="chevron" size={18} className="muted" />
          </button>
        ))}
        <button className="row add-row" onClick={() => setPicker(true)}>
          <Icon name="plus" size={20} /> Add Procedure
        </button>
      </div>

      <h2 className="section-label">Complications</h2>
      <div className="card list">
        {c.complications.length > 0 && (
          <div className="row">
            <div className="chips static">
              {c.complications.map((k) => (
                <span key={k} className="pill warn">
                  {k}
                </span>
              ))}
            </div>
          </div>
        )}
        {c.complicationNote && <div className="row muted small">{c.complicationNote}</div>}
        <button className="row add-row" onClick={() => setComp(true)}>
          <Icon name={c.complications.length ? 'edit' : 'plus'} size={20} /> {c.complications.length ? 'Edit Complications' : 'Add Complications'}
        </button>
      </div>

      <h2 className="section-label">Op Note</h2>
      <div className="card list">
        {opnotes.length > 0 && (
          <div className="row thumbs">
            {opnotes.map((i) => (
              <Thumb key={i.id} img={i} onClick={() => setViewer(i)} />
            ))}
          </div>
        )}
        <button className="row add-row" onClick={() => opRef.current?.click()}>
          <Icon name="scan" size={20} /> {opnotes.length ? 'Add Page' : 'Add Op Note'}
        </button>
        <input ref={opRef} type="file" accept="image/*" capture="environment" hidden data-testid="opnote-input" onChange={(e) => (onPickFile(e.target.files, 'opnote'), (e.target.value = ''))} />
      </div>

      <h2 className="section-label">Images</h2>
      <div className="card list">
        {pics.length > 0 && (
          <div className="row thumbs">
            {pics.map((i) => (
              <Thumb key={i.id} img={i} onClick={() => setViewer(i)} />
            ))}
          </div>
        )}
        <button className="row add-row" onClick={() => imgRef.current?.click()}>
          <Icon name="image" size={20} /> Add Image
        </button>
        <input ref={imgRef} type="file" accept="image/*" multiple hidden data-testid="image-input" onChange={(e) => (onPickFile(e.target.files, 'image'), (e.target.value = ''))} />
      </div>

      <h2 className="section-label">Notes</h2>
      <NotesField key={c.id} value={c.notes} onSave={(v) => updateCase(c.id, { notes: v })} />

      <button className="btn danger-text block delete-case" onClick={() => setConfirmDelete(true)}>
        <Icon name="trash" size={18} /> Delete case
      </button>

      {picker && (
        <ProcedurePicker
          onClose={() => setPicker(false)}
          onPick={(type) => {
            setPicker(false);
            setEditProc({ type });
          }}
        />
      )}
      {editProc && (
        <ProcedureSheet
          type={editProc.type}
          existing={editProc.existing}
          onClose={() => setEditProc(null)}
          onSave={saveProc}
          onDelete={editProc.existing ? () => setConfirmProc(editProc.existing!) : undefined}
        />
      )}
      {confirmProc && (
        <Confirm
          title="Remove procedure?"
          message={`${procLabel(confirmProc)} and its details will be removed from this case.`}
          confirmLabel="Remove"
          onCancel={() => setConfirmProc(null)}
          onConfirm={() => {
            removeProc(confirmProc);
            setConfirmProc(null);
            setEditProc(null);
          }}
        />
      )}
      {cha && (
        <ChaSheet
          initial={c.cha}
          age={c.age}
          sex={c.sex}
          onClose={() => setCha(false)}
          onSave={async (v) => {
            await updateCase(c.id, { cha: v });
            setCha(false);
          }}
        />
      )}
      {comp && <ComplicationsSheet initial={c.complications} note={c.complicationNote} onClose={() => setComp(false)} onSave={async (list, note) => (await updateCase(c.id, { complications: list, complicationNote: note }), setComp(false))} />}
      {info && <CaseInfoSheet existing={c} onClose={() => setInfo(false)} />}
      {scan && (
        <ImageEditor
          source={scan.src}
          title={scan.kind === 'opnote' ? 'Review Scan' : 'Review Image'}
          defaultFilter={scan.kind === 'opnote' ? 'optimized' : 'original'}
          onClose={() => setScan(null)}
          onSave={async (out) => {
            await addImages([{ ...out, caseId: c.id, kind: scan.kind }]);
            setScan(null);
            toast({ message: scan.kind === 'opnote' ? 'Op note saved' : 'Image saved', kind: 'success' });
          }}
        />
      )}
      {viewer && <ImageViewer img={viewer} onClose={() => setViewer(null)} />}
      {confirmDelete && (
        <Confirm
          title="Delete this case?"
          message={
            <>
              {fmtDate(c.date)} · {patientLine(c.mrn, c.age, c.sex)} with {c.procedures.length} procedure(s) and {caseImgs.length} image(s). You can undo right after.
            </>
          }
          confirmLabel="Delete case"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setConfirmDelete(false);
            nav('cases');
            await deleteCase(c.id);
          }}
        />
      )}
      {printing && <CaseReport c={c} onDone={() => setPrinting(false)} />}
    </section>
  );
}

function ComplicationsSheet({ initial, note, onSave, onClose }: { initial: string[]; note: string; onSave: (l: string[], n: string) => void; onClose: () => void }) {
  const [list, setList] = useState(initial);
  const [text, setText] = useState(note);
  const otherMissing = list.includes('Other') && !text.trim();
  return (
    <Sheet title="Complications" onClose={onClose} onDone={() => !otherMissing && onSave(list, text.trim())} doneDisabled={otherMissing}>
      <ChipSelect label="Complications" options={COMPLICATIONS} value={list} onChange={setList} />
      <label className="field">
        <span>Details {list.includes('Other') && <i className="req">*</i>}</span>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Management, severity, outcome" />
      </label>
      {otherMissing && <p className="field-error">Describe the "Other" complication.</p>}
      <button className="btn primary block" disabled={otherMissing} onClick={() => onSave(list, text.trim())}>
        Save
      </button>
    </Sheet>
  );
}
