import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { applyFilter, fileToDataUrl, processDataUrl, rotate, type ScanFilter } from '../lib/image';
import type { ImageMeta, ImageRec } from '../lib/types';
import { fmtDateTime } from '../lib/util';
import { Icon } from '../components/Icon';
import { Confirm, Segmented, Sheet } from '../components/ui';

const FILTER_LABEL: Record<ScanFilter, string> = { optimized: 'Optimized', original: 'Original', bw: 'B&W' };
const LABEL_FILTER: Record<string, ScanFilter> = { Optimized: 'optimized', Original: 'original', 'B&W': 'bw' };

/**
 * Scan review: choose a filter, rotate, rescan, undo. Each edit is applied to the
 * original capture (rotation + filter), so undo is exact and quality does not degrade.
 */
export function ImageEditor({
  source,
  defaultFilter,
  title,
  onSave,
  onClose,
}: {
  source: string;
  defaultFilter: ScanFilter;
  title: string;
  onSave: (out: { dataUrl: string; thumb: string }) => Promise<void> | void;
  onClose: () => void;
}) {
  type Edit = { src: string; turns: number; filter: ScanFilter };
  const [history, setHistory] = useState<Edit[]>([{ src: source, turns: 0, filter: defaultFilter }]);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cur = history[history.length - 1];

  useEffect(() => {
    let live = true;
    setBusy(true);
    (async () => {
      try {
        const rotated = cur.turns ? await rotate(cur.src, cur.turns) : cur.src;
        const out = await applyFilter(rotated, cur.filter);
        if (live) {
          setPreview(out);
          setError(null);
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [cur]);

  const push = (e: Partial<Edit>) => setHistory((h) => [...h, { ...h[h.length - 1], ...e }]);

  const save = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      await onSave(await processDataUrl(preview));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet title={title} onClose={onClose} onDone={save} doneLabel="Save" doneDisabled={busy || !preview} wide testId="image-editor">
      <div className="editor-stage">
        {preview && <img src={preview} alt="Scan preview" className={busy ? 'dim' : ''} />}
        {busy && <div className="spinner overlay-spinner" aria-label="Processing" />}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="editor-tools">
        <Segmented label="Filter" allowClear={false} options={['Optimized', 'Original', 'B&W']} value={FILTER_LABEL[cur.filter]} onChange={(v) => push({ filter: LABEL_FILTER[v] })} />
        <div className="tool-row">
          <button className="btn" onClick={() => push({ turns: cur.turns - 1 })} aria-label="Rotate left">
            <Icon name="rotateL" size={18} /> Left
          </button>
          <button className="btn" onClick={() => push({ turns: cur.turns + 1 })} aria-label="Rotate right">
            <Icon name="rotateR" size={18} /> Right
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Icon name="refresh" size={18} /> Rescan
          </button>
          <button className="btn" onClick={() => setHistory((h) => h.slice(0, -1))} disabled={history.length < 2}>
            <Icon name="undo" size={18} /> Undo
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              push({ src: await fileToDataUrl(f), turns: 0 });
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        />
      </div>
      <button className="btn primary block" onClick={save} disabled={busy || !preview}>
        Save
      </button>
    </Sheet>
  );
}

export function useFullImage(id: string | null): string | null {
  const { getImage } = useStore();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    if (id) getImage(id).then((r) => live && setSrc(r?.dataUrl ?? null));
    return () => {
      live = false;
    };
  }, [id, getImage]);
  return src;
}

/** Full-size view of a stored image with edit / caption / move / delete. */
export function ImageViewer({ img, onClose }: { img: ImageMeta; onClose: () => void }) {
  const { updateImage, deleteImage } = useStore();
  const full = useFullImage(img.id);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [caption, setCaption] = useState(img.caption);

  if (editing && full) {
    return (
      <ImageEditor
        source={full}
        title="Edit Image"
        defaultFilter="original"
        onClose={() => setEditing(false)}
        onSave={async (out) => {
          await updateImage(img.id, out);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <Sheet title={img.kind === 'opnote' ? 'Op Note' : 'Image'} onClose={onClose} onDone={onClose} wide testId="image-viewer">
      <div className="viewer-stage">{full ? <img src={full} alt={img.caption || 'Case image'} /> : <div className="spinner" />}</div>
      <p className="muted small">Added {fmtDateTime(img.createdAt)}</p>
      <label className="field">
        <span>Caption</span>
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => caption !== img.caption && updateImage(img.id, { caption: caption.trim() })}
          placeholder="e.g. Final PVI map"
        />
      </label>
      <div className="tool-row">
        <button className="btn" onClick={() => setEditing(true)} disabled={!full}>
          <Icon name="edit" size={18} /> Edit
        </button>
        {img.caseId && (
          <button
            className="btn"
            onClick={async () => {
              await updateImage(img.id, { caseId: null });
              onClose();
            }}
          >
            <Icon name="inbox" size={18} /> Move to inbox
          </button>
        )}
        <button className="btn danger-text" onClick={() => setConfirm(true)}>
          <Icon name="trash" size={18} /> Delete
        </button>
      </div>
      {confirm && (
        <Confirm
          title="Delete image?"
          message="The image will be removed from this case. You can undo right after."
          confirmLabel="Delete"
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            setConfirm(false);
            await deleteImage(img.id);
            onClose();
          }}
        />
      )}
    </Sheet>
  );
}

export function Thumb({ img, onClick }: { img: ImageMeta | ImageRec; onClick?: () => void }) {
  return (
    <button className="thumb" onClick={onClick} aria-label={img.caption || `Open image from ${fmtDateTime(img.createdAt)}`}>
      <img src={img.thumb} alt="" />
      {img.caption && <span className="thumb-cap">{img.caption}</span>}
    </button>
  );
}
