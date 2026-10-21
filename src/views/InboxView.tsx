import { useRef, useState } from 'react';
import { useStore } from '../store';
import { processFile } from '../lib/image';
import type { ImageMeta } from '../lib/types';
import { fmtDate, fmtDateTime, patientLine } from '../lib/util';
import { Icon } from '../components/Icon';
import { Empty, Segmented, Sheet } from '../components/ui';
import { ImageViewer } from './Images';
import { matchesSearch } from './CasesView';

function AssignSheet({ img, onClose }: { img: ImageMeta; onClose: () => void }) {
  const { cases, updateImage, toast } = useStore();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'Image' | 'Op note'>('Image');
  // Suggest cases closest in time to when the image was added.
  const sorted = cases
    .filter((c) => matchesSearch(c, q.trim()))
    .sort((a, b) => Math.abs(new Date(a.date).getTime() - img.createdAt) - Math.abs(new Date(b.date).getTime() - img.createdAt))
    .slice(0, 50);
  return (
    <Sheet title="Assign to Case" onClose={onClose} testId="assign-sheet">
      <div className="assign-head">
        <img src={img.thumb} alt="" className="assign-thumb" />
        <div>
          <p className="small muted">Added {fmtDateTime(img.createdAt)}</p>
          <Segmented label="Store as" allowClear={false} options={['Image', 'Op note']} value={kind} onChange={(v) => setKind(v as 'Image' | 'Op note')} />
        </div>
      </div>
      <div className="search">
        <Icon name="search" size={18} />
        <input type="search" placeholder="Search MRN, procedure" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cases to assign" />
      </div>
      {cases.length === 0 ? (
        <p className="muted">Create a case first, then assign images to it.</p>
      ) : (
        <div className="card list">
          {sorted.map((c) => (
            <button
              key={c.id}
              className="row"
              onClick={async () => {
                await updateImage(img.id, { caseId: c.id, kind: kind === 'Op note' ? 'opnote' : 'image' });
                toast({ message: `Assigned to ${fmtDate(c.date)} · ${c.mrn}`, kind: 'success', undo: () => updateImage(img.id, { caseId: null }) });
                onClose();
              }}
            >
              <div className="row-main">
                <b>{fmtDate(c.date)}</b> <span className="muted">· {patientLine(c.mrn, c.age, c.sex)}</span>
              </div>
              <Icon name="chevron" size={18} className="muted" />
            </button>
          ))}
          {sorted.length === 0 && <div className="row muted">No matching cases</div>}
        </div>
      )}
    </Sheet>
  );
}

export function InboxView({ nav }: { nav: (p: string) => void }) {
  const { images, addImages, toast } = useStore();
  const inbox = images.filter((i) => i.caseId === null).sort((a, b) => b.createdAt - a.createdAt);
  const [assign, setAssign] = useState<ImageMeta | null>(null);
  const [view, setView] = useState<ImageMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const out = await Promise.all([...files].map(processFile));
      await addImages(out.map((o) => ({ ...o, caseId: null, kind: 'image' as const })));
      toast({ message: `${out.length} image${out.length === 1 ? '' : 's'} added to inbox`, kind: 'success' });
    } catch (e) {
      toast({ message: (e as Error).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="view" aria-label="Image inbox">
      <div className="toolbar">
        <button className="link back" onClick={() => nav('cases')}>
          <Icon name="back" size={20} /> Cases
        </button>
        <span className="grow" />
        <button className="icon-btn accent" aria-label="Add images to inbox" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Icon name="plus" size={24} />
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden data-testid="inbox-input" onChange={(e) => (onFiles(e.target.files), (e.target.value = ''))} />
      </div>
      <h1 className="large-title">Image Inbox</h1>
      <p className="muted small">Import tracings or screenshots in bulk now, attach them to cases later.</p>
      {busy && (
        <p className="muted" aria-busy="true">
          <span className="spinner inline" /> Processing images…
        </p>
      )}
      {inbox.length === 0 ? (
        <Empty icon="inbox" title="Inbox is empty">
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={18} /> Import images
          </button>
        </Empty>
      ) : (
        <div className="card list">
          {inbox.map((i) => (
            <div key={i.id} className="row inbox-row" data-testid="inbox-row">
              <button className="thumb" onClick={() => setView(i)} aria-label="View image">
                <img src={i.thumb} alt="" />
              </button>
              <span className="grow">{fmtDateTime(i.createdAt)}</span>
              <button className="btn small" onClick={() => setAssign(i)}>
                Assign
              </button>
            </div>
          ))}
        </div>
      )}
      {assign && <AssignSheet img={assign} onClose={() => setAssign(null)} />}
      {view && <ImageViewer img={view} onClose={() => setView(null)} />}
    </section>
  );
}
