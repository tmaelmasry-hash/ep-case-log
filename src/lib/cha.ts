import type { ChaInputs, Sex } from './types';
import { PROC_BY_TYPE } from './catalog';
import type { CaseRec } from './types';

export interface ChaResult {
  /** CHA2DS2-VASc (0-9). */
  score: number;
  /** CHA2DS2-VA, the sex-neutral variant used by the 2024 ESC AF guideline (0-8). */
  vaScore: number;
  items: { label: string; points: number }[];
}

export const CHA_ITEMS: { key: keyof ChaInputs; label: string; points: number }[] = [
  { key: 'chf', label: 'Congestive heart failure / LV dysfunction', points: 1 },
  { key: 'htn', label: 'Hypertension', points: 1 },
  { key: 'diabetes', label: 'Diabetes mellitus', points: 1 },
  { key: 'strokeTia', label: 'Prior stroke / TIA / thromboembolism', points: 2 },
  { key: 'vascular', label: 'Vascular disease (MI, PAD, aortic plaque)', points: 1 },
];

export function agePoints(age: number | null): number {
  if (age === null || Number.isNaN(age)) return 0;
  if (age >= 75) return 2;
  if (age >= 65) return 1;
  return 0;
}

export function chaScore(inputs: ChaInputs, age: number | null, sex: Sex): ChaResult {
  const items: ChaResult['items'] = [];
  for (const it of CHA_ITEMS) if (inputs[it.key]) items.push({ label: it.label, points: it.points });
  const ap = agePoints(age);
  if (ap) items.push({ label: ap === 2 ? 'Age ≥ 75' : 'Age 65–74', points: ap });
  const vaScore = items.reduce((s, i) => s + i.points, 0);
  let score = vaScore;
  if (sex === 'F') {
    items.push({ label: 'Female sex', points: 1 });
    score += 1;
  }
  return { score, vaScore, items };
}

export function caseNeedsCha(c: Pick<CaseRec, 'procedures'>): boolean {
  return c.procedures.some((p) => PROC_BY_TYPE[p.type]?.needsCha);
}

/** Score for display, or null when not applicable / not entered. */
export function caseCha(c: CaseRec): ChaResult | null {
  if (!caseNeedsCha(c) || !c.cha) return null;
  return chaScore(c.cha, c.age, c.sex);
}
