import { describe, expect, it } from 'vitest';
import { config } from './harness.ts';
import { historyItems } from '../../server/domain/cases.ts';
import type { CaseRecord } from '../../shared/caseTypes.ts';

describe('history shows a list of codes by label', () => {
  it('an accepted AI value kept as the text \'["ISCHEMIC"]\' reads "Ischemic" (live, 7 Nov)', () => {
    const rec = { history: [{ at: '2026-11-07T20:35:00Z', by: 'u1', kind: 'edit', entity: 'CLINICAL_PROFILE_SNAPSHOTS', field: 'cardiomyopathy_types', text: 'ai_accepted', old: null, new: '["ISCHEMIC"]' }] } as unknown as CaseRecord;
    const [item] = historyItems(config.dict, rec, () => 'admin');
    expect(item.new).toBe('Ischemic');
    expect(item.old).toBe('—');
  });
});
