// Hijri period helpers (owner): Gregorian in, Hijri worked out; Hijri shortcuts become Gregorian ranges.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hijriLabel, hijriPresets } from '../../src/lib/hijri';

afterEach(() => vi.useRealTimers());

describe('hijri', () => {
  it('labels a Gregorian date in Umm al-Qura', () => {
    expect(hijriLabel('2026-06-16')).toMatch(/^Muharram 1, 1448|^1 Muharram 1448/);
    expect(hijriLabel('')).toBe('');
  });

  it('turns this Hijri year, the last Ramadan and the last Dhu al-Hijjah into date ranges', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T09:00:00'));
    const p = Object.fromEntries(hijriPresets().map(([l, a, b]) => [l, [a, b]]));
    expect(p['Hijri year 1448']).toEqual(['2026-06-16', '2026-10-23']);
    expect(p['Ramadan 1447'][0]).toBe('2026-02-18');
    expect(p['Ramadan 1447'][1]).toBe('2026-03-19');
    expect(p['Dhu al-Hijjah 1447'][0]).toBe('2026-05-18');
    expect(p['Dhu al-Hijjah 1447'][1]).toBe('2026-06-15');
  });
});
