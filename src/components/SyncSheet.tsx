// Sync sheet (owner R3-4, approved preview): what this device still has to send to the Google Sheet, what the
// server refused (Retry / Discard), and Sync now.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { caseCount } from '../lib/localdb';
import { sync } from '../lib/sync';
import { Confirm, Sheet } from './ui';

const time = (ms: number) => new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export function SyncSheet({ onClose }: { onClose: () => void }) {
  const s = useSyncExternalStore(sync.subscribe, sync.getState);
  const items = sync.list();
  const [kept, setKept] = useState<number | null>(null);
  const [discard, setDiscard] = useState<number | null>(null);
  useEffect(() => void caseCount().then((n) => setKept(n ?? null)), [s.waiting]);
  const waiting = items.filter((i) => !i.attention);
  const attention = items.filter((i) => i.attention);
  const status = s.attention ? `${s.attention} need attention` : s.waiting ? (s.offline ? `Offline · ${s.waiting} waiting` : `Syncing ${s.waiting}…`) : 'Everything is in the Google Sheet';
  return (
    <Sheet title="Sync" closeLabel="Close" onClose={onClose} onDone={() => sync.kick(0)} doneLabel="Sync now">
      <div className="group" data-testid="sync-sheet">
        <div className="frow inline">
          <span className="lab">Status</span>
          <span className="ios-value">{status}</span>
        </div>
        <div className="frow inline">
          <span className="lab">Last synced</span>
          <span className="ios-value">{s.lastSynced ? time(s.lastSynced) : '—'}</span>
        </div>
        <div className="frow inline">
          <span className="lab">Kept on this device</span>
          <span className="ios-value">{!s.persistent ? 'Not kept (this browser blocks storage)' : kept === null ? '—' : count(kept, 'case')}</span>
        </div>
      </div>
      {!s.persistent && <p className="note">This browser does not keep data: waiting changes are lost if the page is closed before they are sent.</p>}

      <h3 className="sechead">Waiting</h3>
      <div className="group">
        {waiting.map((i) => (
          <div key={i.seq} className="frow inline">
            <span className="lab">
              {i.label} · {count(i.ops.length, 'change')}
            </span>
            <span className="ios-value">{time(i.at)}</span>
          </div>
        ))}
        {!waiting.length && <div className="grow-row muted">Nothing waiting</div>}
      </div>

      {attention.length > 0 && (
        <>
          <h3 className="sechead">Needs attention</h3>
          <div className="group" data-testid="sync-attention">
            {attention.map((i) => (
              <div key={i.seq} className="frow stack">
                <span className="lab">
                  {i.label} · {count(i.ops.length, 'change')}
                </span>
                <span className="hint">{i.attention}</span>
                <div className="mini-seg">
                  <button type="button" onClick={() => sync.retryItem(i.seq)}>
                    Retry
                  </button>
                  <button type="button" onClick={() => setDiscard(i.seq)}>
                    Discard
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {discard !== null && (
        <Confirm
          title="Discard these changes?"
          message="They were not saved in the Google Sheet and will be removed from this device."
          confirmLabel="Discard"
          onCancel={() => setDiscard(null)}
          onConfirm={() => {
            sync.discard(discard);
            setDiscard(null);
          }}
        />
      )}
    </Sheet>
  );
}
