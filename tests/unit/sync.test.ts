// Local-first L2: outbox batches stay within the server's limits and keep their order.
import { describe, expect, it } from 'vitest';
import { chunkOps, toBatch, type Op } from '../../src/lib/sync';

const change = (i: number): Op => ({ kind: 'change', entity: 'PATIENTS', id: 'patient_1', field: `f${i}`, value: i });

describe('sync batches', () => {
  it('splits a long offline queue at the server limits, in order', () => {
    const ops = Array.from({ length: 450 }, (_, i) => change(i));
    const chunks = chunkOps(ops);
    expect(chunks.map((c) => c.length)).toEqual([200, 200, 50]);
    expect(chunks.flat()).toEqual(ops);
  });
  it('builds the edit batch the server reads', () => {
    const b = toBatch([{ kind: 'create', entity: 'ECG_STUDIES', id: 'ecg_1' }, change(1), { kind: 'remove', entity: 'ECG_STUDIES', id: 'ecg_1' }, { kind: 'na', entity: 'PATIENTS', field: 'x', procedure_id: null, reason: 'Not documented' }]);
    expect(b.creates).toHaveLength(1);
    expect(b.changes).toHaveLength(1);
    expect(b.removes).toHaveLength(1);
    expect(b.not_available).toHaveLength(1);
  });
});
