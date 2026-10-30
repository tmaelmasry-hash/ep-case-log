// R4-6: Dashboard click filter — which cases a month and/or a procedure type pick sends to the server.
import { describe, expect, it } from 'vitest';
import type { CaseSummary } from '../../shared/caseTypes.ts';
import { categoriesOf } from '../../shared/readiness.ts';
import type { Dictionary } from '../../shared/dictionary.ts';
import { NO_PICK, pickCaseIds, pickText } from '../../src/lib/dashPick.ts';

// A tiny made-up layout: AF and FLUTTER components are their own types; DEVICE_IMPLANT is "DEVICES".
const dict = { layout: { core_categories: { _note: 'x', AF_ABLATION: ['AF'], FLUTTER_ABLATION: ['FLUTTER'], DEVICES: ['DEVICE_IMPLANT'] } } } as unknown as Dictionary;
const cats = (components: string[]) => categoriesOf(dict, components);

const c = (id: string, date: string | null, components: string[][], planned: string | null = null) =>
  ({ case_id: id, mrn: '9990001', episode_start_date: date, procedures: components.map((x, i) => ({ id: `${id}-p${i}`, start: date, type: null, status: null, components: x })), planned_type: planned }) as unknown as CaseSummary;

const cases = [
  c('a', '2026-10-03', [['AF']]),
  c('b', '2026-10-20', [['AF', 'FLUTTER']]),
  c('d', '2026-09-30', [['FLUTTER'], ['DEVICE_IMPLANT']]),
  c('e', null, [['AF']]),
  c('f', '2026-10-05', [], 'AF'),
];

describe('Dashboard click filter', () => {
  it('no pick keeps every case', () => {
    expect(pickCaseIds(cases, NO_PICK, cats)).toEqual(['a', 'b', 'd', 'e', 'f']);
  });
  it('a month keeps cases whose episode starts in it; no date never matches', () => {
    expect(pickCaseIds(cases, { month: '2026-10', type: null }, cats)).toEqual(['a', 'b', 'f']);
    expect(pickCaseIds(cases, { month: '2026-09', type: null }, cats)).toEqual(['d']);
  });
  it('a type keeps cases with any procedure of that type (a two-type case counts in both)', () => {
    expect(pickCaseIds(cases, { month: null, type: 'AF_ABLATION' }, cats)).toEqual(['a', 'b', 'e']);
    expect(pickCaseIds(cases, { month: null, type: 'FLUTTER_ABLATION' }, cats)).toEqual(['b', 'd']);
    expect(pickCaseIds(cases, { month: null, type: 'DEVICES' }, cats)).toEqual(['d']);
  });
  it('month and type combine; a planned type alone is not a procedure', () => {
    expect(pickCaseIds(cases, { month: '2026-10', type: 'AF_ABLATION' }, cats)).toEqual(['a', 'b']);
    expect(pickCaseIds(cases, { month: '2026-08', type: 'AF_ABLATION' }, cats)).toEqual([]);
  });
  it('describes the pick for the Filtered bar', () => {
    expect(pickText({ month: '2026-10', type: 'AF_ABLATION' }, () => 'AF Ablation')).toBe('Oct 2026 · AF Ablation');
    expect(pickText({ month: null, type: 'DEVICES' }, () => 'Devices')).toBe('Devices');
  });
});
