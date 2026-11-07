import { describe, expect, it } from 'vitest';
import { normalizeForQuote, quoteInNote } from '../../server/ai/redact.ts';

const note = normalizeForQuote('Clinic 20 Oct 2026. Current medications: sacubitril/valsartan 49/51 mg twice daily, bisoprolol 5 mg daily, spironolactone 25 mg daily.');
const q = (s: string) => quoteInNote(note, normalizeForQuote(s));

describe('quoteInNote', () => {
  it('finds a quote word for word', () => {
    expect(q('bisoprolol 5 mg daily')).toBe(true);
  });
  it('accepts a quote shortened with "..." when every piece is in the note, in order (Groq, 7 Nov)', () => {
    expect(q('Current medications: ... bisoprolol 5 mg daily ...')).toBe(true);
    expect(q('Current medications: … spironolactone 25 mg daily')).toBe(true);
  });
  it('refuses a piece that is not in the note', () => {
    expect(q('Current medications: ... metoprolol 50 mg daily ...')).toBe(false);
    expect(q('amiodarone 200 mg')).toBe(false);
  });
  it('refuses pieces out of order', () => {
    expect(q('spironolactone 25 mg daily ... Current medications:')).toBe(false);
  });
  it('refuses a quote that is only dots or tiny pieces', () => {
    expect(q('...')).toBe(false);
    expect(q('a ... b')).toBe(false);
  });
});
