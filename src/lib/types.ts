export type Sex = 'M' | 'F' | '';
export type FieldValue = string | string[] | number | boolean | null;

export interface Procedure {
  id: string;
  type: string;
  details: Record<string, FieldValue>;
  notes: string;
}

export interface ChaInputs {
  chf: boolean;
  htn: boolean;
  diabetes: boolean;
  strokeTia: boolean;
  vascular: boolean;
}

/** Fields shared by every synced record. */
export interface SyncFields {
  id: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
  /** Local-only: changed since the last successful push. */
  _dirty?: 1;
}

export interface CaseRec extends SyncFields {
  date: string; // YYYY-MM-DD
  mrn: string;
  age: number | null;
  sex: Sex;
  role: string;
  fluoroMin: number | null;
  procedures: Procedure[];
  complications: string[];
  complicationNote: string;
  cha: ChaInputs | null;
  notes: string;
}

export type ImageKind = 'image' | 'opnote';

export interface ImageRec extends SyncFields {
  caseId: string | null; // null = in the inbox
  kind: ImageKind;
  caption: string;
  thumb: string; // small JPEG data URL
  dataUrl: string; // full JPEG data URL
}

/** Image record held in memory (full image loaded on demand). */
export type ImageMeta = Omit<ImageRec, 'dataUrl'>;

export interface BackupFile {
  app: 'ep-caselog';
  version: 1;
  exportedAt: string;
  cases: CaseRec[];
  images: ImageRec[];
}
