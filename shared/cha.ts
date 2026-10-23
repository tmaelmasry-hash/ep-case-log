// CHA₂DS₂-VASc display (owner D6, preview V3): computed from dictionary fields, never stored. No number until every
// item is known (Yes/No; age from date of birth; sex at birth); until then "incomplete".
// Items: C = CLINICAL_PROFILE_SNAPSHOTS.heart_failure, H = hypertension, A₂ = age ≥ 75, D = diabetes,
// S₂ = prior stroke / TIA / thromboembolism (M-4a: three items; 2 points if any is Yes, 0 when all three are No; the old
// combined item is read only when none of the three is answered), V = vascular_disease, A = age 65–74, Sc = sex at birth female.
// The owner's field list (D6) uses vascular_disease only; coronary_artery_disease_or_prior_mi is not added to V.
import { ageOn } from './caseTypes.ts';

type Row = Record<string, unknown>;

export interface ChaResult {
  /** The score when every item is known; null = incomplete. */
  score: number | null;
  /** Items still unknown (labels), e.g. ["Diabetes", "Age"]. */
  missing: string[];
  items: { key: string; label: string; points: number | null }[];
}

const YES_NO: [string, string, number][] = [
  ['heart_failure', 'Heart failure', 1],
  ['hypertension', 'Hypertension', 1],
  ['diabetes', 'Diabetes', 1],
  ['vascular_disease', 'Vascular disease', 1],
];

const STROKE_SPLIT = ['prior_stroke', 'prior_tia', 'prior_thromboembolic_event'];

export function cha2ds2vasc(rows: Record<string, Row[]>): ChaResult {
  const risk = rows.CLINICAL_PROFILE_SNAPSHOTS?.[0] ?? {};
  const ident = rows.PATIENT_IDENTIFIERS?.[0] ?? {};
  const pat = rows.PATIENTS?.[0] ?? {};
  const ep = rows.EP_EPISODES?.[0] ?? {};
  const items: ChaResult['items'] = YES_NO.map(([k, label, pts]) => ({ key: k, label, points: risk[k] === 'YES' ? pts : risk[k] === 'NO' ? 0 : null }));
  const split = STROKE_SPLIT.map((k) => risk[k]);
  const stroke = split.some((v) => v === 'YES') ? 2 : split.every((v) => v === 'NO') ? 0 : split.every((v) => v === undefined || v === null || v === '') ? (risk.prior_stroke_tia_systemic_embolism === 'YES' ? 2 : risk.prior_stroke_tia_systemic_embolism === 'NO' ? 0 : null) : null;
  items.splice(3, 0, { key: 'stroke', label: 'Stroke / TIA / thromboembolism', points: stroke });
  const age = ageOn(ident.date_of_birth, ep.episode_start_date);
  items.push({ key: 'age', label: 'Age', points: age === null ? null : age >= 75 ? 2 : age >= 65 ? 1 : 0 });
  const sex = pat.sex_at_birth;
  items.push({ key: 'sex', label: 'Sex at birth', points: sex === 'FEMALE' ? 1 : sex === 'MALE' ? 0 : null });
  const missing = items.filter((i) => i.points === null).map((i) => i.label);
  return { score: missing.length ? null : items.reduce((n, i) => n + (i.points ?? 0), 0), missing, items };
}

/** Shown for AF / flutter care: an AF, flutter or AV-junction ablation component, or an AF / flutter diagnosis. */
export function chaRelevant(rows: Record<string, Row[]>): boolean {
  const comps = (rows.PROCEDURE_COMPONENTS ?? []).map((c) => String(c.component_type));
  const dx = String(rows.ARRHYTHMIA_INDICATIONS?.[0]?.primary_ep_diagnosis ?? '');
  return comps.some((c) => ['AF', 'FLUTTER', 'AVJ_ABLATION'].includes(c)) || ['AF', 'TYPICAL_AFL', 'ATYPICAL_AFL'].includes(dx);
}
