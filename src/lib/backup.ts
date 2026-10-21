import { PROC_BY_TYPE, procLabel, procSummary } from './catalog';
import { caseCha } from './cha';
import type { BackupFile, CaseRec, ImageRec } from './types';
import { csvEscape } from './util';

export function buildBackup(cases: CaseRec[], images: ImageRec[], now = new Date()): BackupFile {
  return {
    app: 'ep-caselog',
    version: 1,
    exportedAt: now.toISOString(),
    cases: cases.map(({ _dirty, ...r }) => (void _dirty, r)),
    images: images.map(({ _dirty, ...r }) => (void _dirty, r)),
  };
}

/** Validates an untrusted backup file; throws a user-readable error. */
export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const d = data as Partial<BackupFile>;
  if (!d || d.app !== 'ep-caselog' || !Array.isArray(d.cases) || !Array.isArray(d.images)) {
    throw new Error('This is not an EP Case Log backup file.');
  }
  if (d.version !== 1) throw new Error(`Unsupported backup version: ${String(d.version)}`);
  const badCase = d.cases.find(
    (c) => !c || typeof c.id !== 'string' || typeof c.updatedAt !== 'number' || typeof c.date !== 'string' || !Array.isArray(c.procedures),
  );
  if (badCase) throw new Error('Backup contains a malformed case record.');
  const badImg = d.images.find((i) => !i || typeof i.id !== 'string' || typeof i.updatedAt !== 'number' || typeof i.thumb !== 'string');
  if (badImg) throw new Error('Backup contains a malformed image record.');
  // Fill fields that older/partial exports might lack.
  const defaults: Partial<CaseRec> = {
    complications: [],
    complicationNote: '',
    notes: '',
    role: '',
    fluoroMin: null,
    cha: null,
    age: null,
    sex: '',
  };
  d.cases = d.cases.map((c) => ({ ...defaults, ...c, createdAt: c.createdAt ?? c.updatedAt }) as CaseRec);
  return d as BackupFile;
}

export function casesToCsv(cases: CaseRec[]): string {
  const header = ['Date', 'MRN', 'Age', 'Sex', 'Role', 'Fluoro (min)', 'Procedures', 'Details', 'Categories', 'Complications', 'CHA2DS2-VASc', 'CHA2DS2-VA', 'Notes'];
  const rows = cases
    .filter((c) => !c.deleted)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((c) => {
      const cha = caseCha(c);
      return [
        c.date,
        c.mrn,
        c.age ?? '',
        c.sex,
        c.role,
        c.fluoroMin ?? '',
        c.procedures.map(procLabel).join('; '),
        c.procedures.map((p) => `${procLabel(p)}: ${procSummary(p)}`).join('; '),
        [...new Set(c.procedures.map((p) => PROC_BY_TYPE[p.type]?.category ?? 'Other'))].join('; '),
        [...c.complications, c.complicationNote].filter(Boolean).join('; '),
        cha?.score ?? '',
        cha?.vaScore ?? '',
        c.notes,
      ].map(csvEscape).join(',');
    });
  return '﻿' + [header.join(','), ...rows].join('\r\n');
}
