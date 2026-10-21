import { describe, expect, it } from 'vitest';
import { agePoints, caseNeedsCha, chaScore } from '../../src/lib/cha';
import { computeStats, monthsBetween, rangeFor } from '../../src/lib/stats';
import { mergeInto, shouldAccept } from '../../src/lib/merge';
import { missingRequired, numberError, procSummary, PROC_BY_TYPE } from '../../src/lib/catalog';
import { validateCaseFields, csvEscape } from '../../src/lib/util';
import { buildBackup, casesToCsv, parseBackup } from '../../src/lib/backup';
import { applyFilterToPixels, otsu } from '../../src/lib/image';
import type { CaseRec, ChaInputs } from '../../src/lib/types';

const NONE: ChaInputs = { chf: false, htn: false, diabetes: false, strokeTia: false, vascular: false };
let n = 0;
function mk(p: Partial<CaseRec>): CaseRec {
  n++;
  return { id: `c${n}`, createdAt: n, updatedAt: n, date: '2026-03-01', mrn: 'A1', age: 60, sex: 'M', role: '', fluoroMin: null, procedures: [], complications: [], complicationNote: '', cha: null, notes: '', ...p };
}
const proc = (type: string, details = {}) => ({ id: `p${++n}`, type, details, notes: '' });

describe('CHA2DS2-VASc', () => {
  it('age points', () => {
    expect([agePoints(null), agePoints(64), agePoints(65), agePoints(74), agePoints(75)]).toEqual([0, 0, 1, 1, 2]);
  });
  it('maximum is 9 (VASc) / 8 (VA)', () => {
    const r = chaScore({ chf: true, htn: true, diabetes: true, strokeTia: true, vascular: true }, 80, 'F');
    expect(r.score).toBe(9);
    expect(r.vaScore).toBe(8);
  });
  it('70-year-old man with no risk factors scores 1', () => {
    expect(chaScore(NONE, 70, 'M').score).toBe(1);
  });
  it('female sex adds 1 to VASc but not VA', () => {
    const r = chaScore({ ...NONE, htn: true }, 50, 'F');
    expect(r.score).toBe(2);
    expect(r.vaScore).toBe(1);
  });
  it('stroke/TIA is worth 2', () => {
    expect(chaScore({ ...NONE, strokeTia: true }, 40, 'M').score).toBe(2);
  });
  it('is only prompted for AF, flutter, AV node and LAA closure', () => {
    for (const t of ['af_ablation', 'flutter_ablation', 'avn_ablation', 'laa_closure']) expect(caseNeedsCha({ procedures: [proc(t)] })).toBe(true);
    for (const t of ['svt_ablation', 'vt_ablation', 'device_implant', 'ep_study', 'lead_extraction', 'pvc_ablation']) expect(caseNeedsCha({ procedures: [proc(t)] })).toBe(false);
  });
});

describe('procedure catalog', () => {
  it('summarises AF ablation like the reference layout', () => {
    expect(procSummary(proc('af_ablation', { energy: 'PFA', pvs: ['LSPV', 'LIPV', 'RSPV', 'RIPV'], additional: ['SVC isolation'] }))).toBe('PFA · LSPV, LIPV, RSPV, RIPV · SVC isolation');
  });
  it('reports missing required fields', () => {
    expect(missingRequired('device_implant', { subtype: 'New' })).toEqual(['Device type']);
    expect(missingRequired('device_implant', { subtype: 'New', deviceType: 'ICD dual' })).toEqual([]);
    expect(missingRequired('other', { name: '   ' })).toEqual(['Procedure name']);
    expect(missingRequired('lead_extraction', { leadCount: 2 })).toEqual([]);
  });
  it('validates number ranges', () => {
    const f = PROC_BY_TYPE.laa_closure.fields.find((x) => x.key === 'size')!;
    expect(numberError(f, 5)).toBe('Minimum 10');
    expect(numberError(f, 27)).toBeNull();
    expect(numberError(f, null)).toBeNull();
  });
});

describe('case validation', () => {
  const now = new Date(2026, 9, 21);
  it('accepts a valid case', () => {
    expect(validateCaseFields({ date: '2026-10-21', mrn: '12345678', age: '70' }, now)).toEqual({});
  });
  it('rejects future dates, missing/odd MRN, bad age, bad fluoro', () => {
    const e = validateCaseFields({ date: '2026-10-22', mrn: '', age: '130', fluoroMin: '-1' }, now);
    expect(Object.keys(e).sort()).toEqual(['age', 'date', 'fluoroMin', 'mrn']);
    expect(validateCaseFields({ date: '2026-01-01', mrn: 'ab c', age: '' }, now).mrn).toBeTruthy();
    expect(validateCaseFields({ date: 'garbage', mrn: 'A', age: '' }, now).date).toBeTruthy();
    expect(validateCaseFields({ date: '2026-01-01', mrn: 'A', age: '7.5' }, now).age).toBeTruthy();
  });
});

describe('stats', () => {
  const cases = [
    mk({ date: '2026-01-10', mrn: 'A', procedures: [proc('af_ablation'), proc('flutter_ablation')] }),
    mk({ date: '2026-03-05', mrn: 'B', procedures: [proc('device_implant')], complications: ['Pocket hematoma'] }),
    mk({ date: '2026-03-20', mrn: 'A', procedures: [proc('af_ablation')] }),
    mk({ date: '2026-03-21', mrn: 'C', procedures: [proc('af_ablation')], deleted: true }),
  ];
  it('counts, percentages and month gaps', () => {
    const s = computeStats(cases, { from: null, to: null });
    expect(s.caseCount).toBe(3);
    expect(s.procedureCount).toBe(4);
    expect(s.patientCount).toBe(2);
    expect(s.byMonth).toEqual([
      { month: '2026-01', count: 1 },
      { month: '2026-02', count: 0 },
      { month: '2026-03', count: 2 },
    ]);
    const abl = s.byCategory.find((c) => c.category === 'Ablation')!;
    expect(abl.count).toBe(3);
    expect(abl.types[0]).toEqual({ label: 'AF Ablation', count: 2, pct: 0.5 });
    expect(s.complicationRate).toBeCloseTo(1 / 3);
  });
  it('filters by range', () => {
    const s = computeStats(cases, { from: '2026-03-01', to: '2026-03-31' });
    expect(s.caseCount).toBe(2);
    expect(s.byMonth).toEqual([{ month: '2026-03', count: 2 }]);
  });
  it('builds preset ranges', () => {
    const now = new Date(2026, 9, 21);
    expect(rangeFor('30d', { from: null, to: null }, now)).toEqual({ from: '2026-09-22', to: '2026-10-21' });
    expect(rangeFor('12mo', { from: null, to: null }, now)).toEqual({ from: '2025-11-01', to: '2026-10-21' });
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('merge (last write wins)', () => {
  it('keeps the newer record and propagates tombstones', () => {
    const a = mk({ updatedAt: 100, notes: 'old' });
    const map = new Map([[a.id, a]]);
    expect(mergeInto(map, [{ ...a, updatedAt: 50, notes: 'older' }])).toHaveLength(0);
    expect(mergeInto(map, [{ ...a, updatedAt: 200, deleted: true }])).toHaveLength(1);
    expect(map.get(a.id)!.deleted).toBe(true);
  });
  it('tie-break is deterministic and idempotent', () => {
    const a = mk({ updatedAt: 5, notes: 'a' });
    const b = { ...a, notes: 'b' };
    expect(shouldAccept(a, b)).not.toBe(shouldAccept(b, a));
    expect(shouldAccept(a, { ...a })).toBe(false);
  });
  it('strips the local dirty flag', () => {
    const map = new Map<string, CaseRec>();
    mergeInto(map, [{ ...mk({}), _dirty: 1 }]);
    expect([...map.values()][0]._dirty).toBeUndefined();
  });
});

describe('backup & CSV', () => {
  it('round-trips and validates', () => {
    const c = mk({ _dirty: 1, notes: 'x' });
    const b = buildBackup([c], []);
    const back = parseBackup(JSON.stringify(b));
    expect(back.cases[0].notes).toBe('x');
    expect('_dirty' in back.cases[0]).toBe(false);
    expect(() => parseBackup('nope')).toThrow(/not valid JSON/);
    expect(() => parseBackup('{"app":"other"}')).toThrow(/not an EP Case Log/);
    expect(() => parseBackup(JSON.stringify({ ...b, cases: [{ id: 1 }] }))).toThrow(/malformed case/);
  });
  it('escapes CSV values', () => {
    expect(csvEscape('a,"b"')).toBe('"a,""b"""');
    const csv = casesToCsv([mk({ notes: 'line1\nline2', procedures: [proc('af_ablation', { energy: 'RF' })], cha: { ...NONE, htn: true }, age: 70 })]);
    expect(csv).toContain('"line1\nline2"');
    expect(csv.split('\r\n')[1]).toContain(',2,2,'); // VASc 2, VA 2 for a 70M with HTN
  });
});

describe('scan filters', () => {
  it('otsu splits a bimodal histogram', () => {
    const h = new Uint32Array(256);
    h[30] = 100;
    h[220] = 100;
    const t = otsu(h, 200);
    expect(t).toBeGreaterThanOrEqual(30);
    expect(t).toBeLessThan(220);
  });
  it('optimized stretches grey paper toward white and keeps ink dark', () => {
    const px = new Uint8ClampedArray([180, 180, 180, 255, 180, 180, 180, 255, 180, 180, 180, 255, 40, 40, 40, 255]);
    applyFilterToPixels(px, 'optimized');
    expect(px[0]).toBe(255);
    expect(px[12]).toBe(0);
  });
});
