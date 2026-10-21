import type { FieldValue, Procedure } from './types';

export type FieldKind = 'segmented' | 'select' | 'multi' | 'number' | 'text' | 'toggle';

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  options?: string[];
  required?: boolean;
  unit?: string;
  min?: number;
  max?: number;
  /** Shown in the one-line summary (default true). */
  summary?: boolean;
}

export type Category = 'Ablation' | 'Device' | 'Structural' | 'Diagnostic' | 'Other';

export interface ProcedureDef {
  type: string;
  label: string;
  category: Category;
  icon: string;
  fields: FieldDef[];
  /** CHA2DS2-VASc is relevant for this procedure (AF, flutter, AV node, LAA closure). */
  needsCha?: boolean;
}

const ENERGY = ['RF', 'PFA', 'Cryo'];
const OUTCOME = ['Success', 'Partial', 'Unsuccessful'];

export const CATEGORIES: Category[] = ['Ablation', 'Device', 'Structural', 'Diagnostic', 'Other'];

export const CATEGORY_COLOR: Record<Category, string> = {
  Ablation: 'var(--cat-ablation)',
  Device: 'var(--cat-device)',
  Structural: 'var(--cat-structural)',
  Diagnostic: 'var(--cat-diagnostic)',
  Other: 'var(--cat-other)',
};

export const PROCEDURES: ProcedureDef[] = [
  {
    type: 'af_ablation', label: 'AF Ablation', category: 'Ablation', icon: 'wave', needsCha: true,
    fields: [
      { key: 'energy', label: 'Energy', kind: 'segmented', options: ENERGY, required: true },
      { key: 'index', label: 'Procedure', kind: 'segmented', options: ['De novo', 'Redo'] },
      { key: 'afType', label: 'AF type', kind: 'select', options: ['Paroxysmal', 'Persistent', 'Long-standing persistent'] },
      { key: 'pvs', label: 'Veins isolated', kind: 'multi', options: ['LSPV', 'LIPV', 'RSPV', 'RIPV', 'LCPV'] },
      { key: 'additional', label: 'Additional lesions', kind: 'multi', options: ['Posterior wall', 'SVC isolation', 'CTI line', 'Roof line', 'Mitral line', 'LAA isolation', 'Other substrate'] },
    ],
  },
  {
    type: 'flutter_ablation', label: 'Flutter Ablation', category: 'Ablation', icon: 'bolt', needsCha: true,
    fields: [
      { key: 'circuit', label: 'Circuit', kind: 'segmented', options: ['Typical CTI', 'Atypical'], required: true },
      { key: 'energy', label: 'Energy', kind: 'segmented', options: ENERGY },
      { key: 'endpoint', label: 'Endpoint', kind: 'segmented', options: ['Bidirectional block', 'Termination only', 'Not achieved'] },
    ],
  },
  {
    type: 'vt_ablation', label: 'VT Ablation', category: 'Ablation', icon: 'spike',
    fields: [
      { key: 'substrate', label: 'Substrate', kind: 'select', options: ['Ischemic', 'Non-ischemic', 'Idiopathic', 'Other'], required: true },
      { key: 'approach', label: 'Approach', kind: 'multi', options: ['Endocardial', 'Epicardial', 'Transseptal', 'Retrograde aortic'] },
      { key: 'energy', label: 'Energy', kind: 'segmented', options: ENERGY },
      { key: 'endpoint', label: 'Endpoint', kind: 'segmented', options: ['Non-inducible', 'Clinical VT suppressed', 'Inducible', 'Not tested'] },
      { key: 'support', label: 'Mechanical support', kind: 'toggle' },
    ],
  },
  {
    type: 'svt_ablation', label: 'SVT Ablation', category: 'Ablation', icon: 'heart',
    fields: [
      { key: 'mechanism', label: 'Mechanism', kind: 'select', options: ['AVNRT', 'AVRT / accessory pathway', 'Focal AT', 'Other'], required: true },
      { key: 'energy', label: 'Energy', kind: 'segmented', options: ['RF', 'Cryo'] },
      { key: 'outcome', label: 'Outcome', kind: 'segmented', options: OUTCOME },
    ],
  },
  {
    type: 'pvc_ablation', label: 'PVC/PAC Ablation', category: 'Ablation', icon: 'bars',
    fields: [
      { key: 'ectopy', label: 'Ectopy', kind: 'segmented', options: ['PVC', 'PAC'], required: true },
      { key: 'origin', label: 'Origin', kind: 'text' },
      { key: 'energy', label: 'Energy', kind: 'segmented', options: ENERGY },
      { key: 'outcome', label: 'Outcome', kind: 'segmented', options: OUTCOME },
    ],
  },
  {
    type: 'avn_ablation', label: 'AV Node Ablation', category: 'Ablation', icon: 'heartDown', needsCha: true,
    fields: [
      { key: 'pacing', label: 'Pacing strategy', kind: 'select', options: ['Conduction system pacing', 'RV pacing', 'CRT', 'Pre-existing device'] },
      { key: 'outcome', label: 'Outcome', kind: 'segmented', options: ['Complete AV block', 'Unsuccessful'] },
    ],
  },
  {
    type: 'device_implant', label: 'Device Implant', category: 'Device', icon: 'chip',
    fields: [
      { key: 'subtype', label: 'Subtype', kind: 'segmented', options: ['New', 'Gen change', 'Upgrade', 'Revision'], required: true },
      { key: 'deviceType', label: 'Device type', kind: 'select', options: ['PPM single', 'PPM dual', 'Leadless PPM', 'ICD single', 'ICD dual', 'S-ICD', 'EV-ICD', 'CRT-P', 'CRT-D', 'Loop recorder'], required: true },
      { key: 'manufacturer', label: 'Manufacturer', kind: 'segmented', options: ['Medtronic', 'Abbott', 'Boston Scientific', 'Biotronik', 'Other'] },
      { key: 'leads', label: 'Leads', kind: 'multi', options: ['RA', 'RV', 'LV (CS)', 'LBBP', 'His'] },
    ],
  },
  {
    type: 'lead_extraction', label: 'Lead Extraction', category: 'Device', icon: 'extract',
    fields: [
      { key: 'leadCount', label: 'Leads extracted', kind: 'number', min: 1, max: 10, required: true },
      { key: 'indication', label: 'Indication', kind: 'select', options: ['Infection', 'Malfunction', 'Upgrade / access', 'Other'] },
      { key: 'tools', label: 'Tools', kind: 'multi', options: ['Simple traction', 'Mechanical sheath', 'Laser sheath', 'Rotational sheath', 'Femoral snare'] },
      { key: 'outcome', label: 'Outcome', kind: 'segmented', options: ['Complete', 'Clinical success', 'Failure'] },
    ],
  },
  {
    type: 'laa_closure', label: 'LAA Closure', category: 'Structural', icon: 'clipboard', needsCha: true,
    fields: [
      { key: 'device', label: 'Device', kind: 'select', options: ['Watchman FLX', 'Watchman FLX Pro', 'Amulet', 'Other'], required: true },
      { key: 'size', label: 'Size', kind: 'number', unit: 'mm', min: 10, max: 45 },
      { key: 'imaging', label: 'Imaging', kind: 'segmented', options: ['TEE', 'ICE', 'CT-guided'] },
      { key: 'leak', label: 'Peri-device leak', kind: 'segmented', options: ['None', '< 5 mm', '≥ 5 mm'] },
    ],
  },
  {
    type: 'ep_study', label: 'EP Study', category: 'Diagnostic', icon: 'nodes',
    fields: [
      { key: 'indication', label: 'Indication', kind: 'select', options: ['Syncope', 'Palpitations', 'Risk stratification', 'Pre-excitation', 'Other'], required: true },
      { key: 'result', label: 'Result', kind: 'segmented', options: ['Non-inducible', 'Inducible', 'Abnormal conduction'] },
      { key: 'finding', label: 'Finding', kind: 'text' },
    ],
  },
  {
    type: 'other', label: 'Other Procedure', category: 'Other', icon: 'plus',
    fields: [{ key: 'name', label: 'Procedure name', kind: 'text', required: true }],
  },
];

export const PROC_BY_TYPE: Record<string, ProcedureDef> = Object.fromEntries(PROCEDURES.map((p) => [p.type, p]));

export const COMPLICATIONS = [
  'Pericardial effusion',
  'Tamponade',
  'Vascular access complication',
  'Stroke / TIA',
  'Phrenic nerve injury',
  'Pneumothorax',
  'Lead dislodgement',
  'Pocket hematoma',
  'New AV block',
  'Atrio-esophageal fistula',
  'Death',
  'Other',
];

export const ROLES = ['Primary', 'Assist', 'Observe'];

export function procLabel(p: Procedure): string {
  if (p.type === 'other') {
    const n = p.details.name;
    return typeof n === 'string' && n.trim() ? n.trim() : 'Other Procedure';
  }
  return PROC_BY_TYPE[p.type]?.label ?? p.type;
}

export function procCategory(p: Procedure): Category {
  return PROC_BY_TYPE[p.type]?.category ?? 'Other';
}

function fmtValue(f: FieldDef, v: FieldValue): string {
  if (v === null || v === undefined || v === '') return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? f.label : '';
  if (typeof v === 'number') {
    if (f.key === 'leadCount') return `${v} lead${v === 1 ? '' : 's'}`;
    return f.unit ? `${v} ${f.unit}` : String(v);
  }
  return v;
}

/** One-line summary of a procedure's structured details, e.g. "PFA · LSPV, LIPV · SVC isolation". */
export function procSummary(p: Procedure): string {
  const def = PROC_BY_TYPE[p.type];
  if (!def) return '';
  return def.fields
    .filter((f) => f.summary !== false && !(p.type === 'other' && f.key === 'name'))
    .map((f) => fmtValue(f, p.details[f.key]))
    .filter(Boolean)
    .join(' · ');
}

/** Returns labels of required fields that are empty. */
export function missingRequired(type: string, details: Record<string, FieldValue>): string[] {
  const def = PROC_BY_TYPE[type];
  if (!def) return [];
  return def.fields
    .filter((f) => f.required)
    .filter((f) => {
      const v = details[f.key];
      if (v === null || v === undefined) return true;
      if (typeof v === 'string') return v.trim() === '';
      if (Array.isArray(v)) return v.length === 0;
      if (typeof v === 'number') return Number.isNaN(v);
      return false;
    })
    .map((f) => f.label);
}

/** Validates a numeric field; returns an error message or null. */
export function numberError(f: FieldDef, v: FieldValue): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'number' || Number.isNaN(v)) return 'Enter a number';
  if (f.min !== undefined && v < f.min) return `Minimum ${f.min}`;
  if (f.max !== undefined && v > f.max) return `Maximum ${f.max}`;
  return null;
}
