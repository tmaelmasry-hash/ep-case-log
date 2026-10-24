// Values the app fills by itself (owner field review, phase 2, 24 Oct 2026). Pure: the server stores them after
// every save, and the browser lays the same values over its device copy, so an offline case shows them at once.
// Only dictionary fields and codes; a person's own answer is never replaced, except for the fields the owner
// asked to be fully automatic (procedure type, Hajj timing, eGFR from creatinine, CSP target, implant date
// precision), which are hidden or read-only on the form.
import { ageOn, type DecodedRow } from './caseTypes.ts';
import { hasValue, type Dictionary } from './dictionary.ts';

export interface Derived {
  entity: string;
  /** The row to write; for a one-per-case section that has no row yet, `create` names its slot and parent. */
  id: string;
  field: string;
  value: unknown;
  create?: { parent_id: string | null };
}

export type Rows = (entity: string) => DecodedRow[];

const ABLATION = ['AVNRT', 'AVRT_WPW', 'AT_SVT', 'AF', 'FLUTTER', 'PVC', 'VT_VF', 'AVJ_ABLATION'];

/** Primary procedure type from the ticked components (ablation first, then device work, LAA, ILR, EPS, other). */
export function procedureType(components: string[], row: { device_action?: unknown; lead_management_type?: unknown }): string | null {
  if (components.some((c) => ABLATION.includes(c))) return 'ABLATION';
  if (components.includes('LEAD_MANAGEMENT') && !components.includes('DEVICE_IMPLANT')) return ['EXTRACT', 'COMPLETE_SYSTEM_EXPLANT'].includes(String(row.lead_management_type)) ? 'EXTRACTION' : 'LEAD_REVISION';
  if (components.includes('DEVICE_IMPLANT') || components.includes('CRT_CSP')) return ['GENERATOR_CHANGE', 'UPGRADE', 'DOWNGRADE'].includes(String(row.device_action)) ? 'GENERATOR_CHANGE' : 'CIED_IMPLANT';
  if (components.includes('LEAD_MANAGEMENT')) return 'EXTRACTION';
  if (components.includes('LAA_CLOSURE')) return 'LAA_CLOSURE';
  if (components.includes('ILR')) return 'ILR';
  if (components.includes('DIAGNOSTIC_EPS')) return 'EPS';
  if (components.includes('OTHER')) return 'OTHER';
  return null;
}

export interface HajjSeason {
  /** [Hijri month, day] the season starts and ends (the end may fall in the next Hijri year). */
  start: [number, number];
  end: [number, number];
  /** The days of the rites: before them "Before Hajj", after them "After Hajj". */
  rites: [[number, number], [number, number]];
}

const HIJRI = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });

function hijri(date: string): [number, number] | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const parts = HIJRI.formatToParts(new Date(`${date.slice(0, 10)}T12:00:00Z`));
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);
  return m && d ? [m, d] : null;
}

const md = ([m, d]: [number, number]) => m * 100 + d;

/** Hajj timing of a date for a Hajj pilgrim (owner: season 1 Dhu al-Qa'dah → 15 Muharram; rites 8–13 Dhu al-Hijjah). */
export function hajjTiming(date: string | null, pilgrim: unknown, season: HajjSeason): string | null {
  if (pilgrim === 'UMRAH') return 'UMRAH_RELATED';
  if (pilgrim !== 'HAJJ') return null;
  const h = date ? hijri(date) : null;
  if (!h) return null;
  const x = md(h);
  const start = md(season.start);
  const end = md(season.end);
  // The season wraps the Hijri new year (Dhu al-Qa'dah … Muharram).
  const inSeason = start <= end ? x >= start && x <= end : x >= start || x <= end;
  if (!inSeason) return 'OUTSIDE_PILGRIMAGE_SEASON';
  if (x >= md(season.rites[0]) && x <= md(season.rites[1])) return 'DURING_HAJJ';
  return x >= start && x < md(season.rites[0]) ? 'PRE_HAJJ' : 'POST_HAJJ';
}

/** eGFR, CKD-EPI 2021 creatinine equation (no race term), creatinine in µmol/L. Whole number, or null. */
export function egfr(creatinineUmol: unknown, age: number | null, sex: unknown): number | null {
  const scr = Number(creatinineUmol) / 88.4;
  if (!Number.isFinite(scr) || scr <= 0 || age === null || age < 18 || (sex !== 'MALE' && sex !== 'FEMALE')) return null;
  const female = sex === 'FEMALE';
  const k = female ? 0.7 : 0.9;
  const a = female ? -0.241 : -0.302;
  const v = 142 * Math.min(scr / k, 1) ** a * Math.max(scr / k, 1) ** -1.2 * 0.9938 ** age * (female ? 1.012 : 1);
  return Math.round(v);
}

/** BMI from height (cm) and weight (kg), one decimal. Shown only; never stored. */
export function bmi(heightCm: unknown, weightKg: unknown): number | null {
  const h = Number(heightCm) / 100;
  const w = Number(weightKg);
  if (!(h > 0.5 && h < 2.6 && w > 2 && w < 400)) return null;
  return Math.round((w / (h * h)) * 10) / 10;
}

/** Primary EP diagnosis (and subtype) suggested by a procedure's components and sections. */
function diagnosisOf(rows: Rows, pid: string, types: string[]): { dx: string; sub?: string } | null {
  const one = (e: string) => rows(e).find((r) => r.procedure_id === pid);
  if (types.includes('AF')) {
    const t = one('AF_ABLATIONS')?.af_type_at_procedure;
    return { dx: 'AF', sub: hasValue(t) ? String(t) : undefined };
  }
  if (types.includes('FLUTTER')) {
    const t = String(one('FLUTTER_ABLATIONS')?.flutter_type ?? '');
    if (t === 'TYPICAL_CTI') return { dx: 'TYPICAL_AFL', sub: 'COUNTERCLOCKWISE_CTI' };
    if (t === 'REVERSE_TYPICAL_CTI') return { dx: 'TYPICAL_AFL', sub: 'CLOCKWISE_CTI' };
    if (t === 'ATYPICAL_RA') return { dx: 'ATYPICAL_AFL', sub: 'RA_ATYPICAL' };
    if (t === 'ATYPICAL_LA') return { dx: 'ATYPICAL_AFL', sub: 'LA_ATYPICAL' };
    return null;
  }
  const svt = String(one('SVT_ABLATIONS')?.svt_mechanism ?? '');
  if (types.includes('AVNRT')) return { dx: 'AVNRT', sub: svt === 'TYPICAL_AVNRT' ? 'TYPICAL_SLOW_FAST' : svt === 'ATYPICAL_AVNRT' ? 'ATYPICAL_AVNRT' : undefined };
  if (types.includes('AVRT_WPW')) {
    if (one('SVT_ABLATIONS')?.accessory_pathway_manifestation === 'MANIFEST') return { dx: 'WPW_PREEXCITATION', sub: 'MANIFEST_WPW' };
    return { dx: 'AVRT', sub: svt === 'ORTHODROMIC_AVRT' ? 'ORTHODROMIC' : svt === 'ANTIDROMIC_AVRT' ? 'ANTIDROMIC' : undefined };
  }
  if (types.includes('AT_SVT')) return svt === 'FOCAL_AT' || svt === 'MACROREENTRANT_AT' ? { dx: svt } : svt === 'OTHER' ? { dx: 'OTHER_SVT' } : null;
  const va = String(one('VENTRICULAR_ABLATIONS')?.va_type ?? '');
  if (types.includes('PVC') || va === 'PVC') return { dx: 'PVC' };
  if (types.includes('VT_VF')) return va === 'VF_TRIGGER' ? { dx: 'VF' } : { dx: 'VT', sub: va === 'IDIOPATHIC_SUSTAINED_VT' ? 'IDIOPATHIC_VT' : va === 'SCAR_MONOMORPHIC_VT' ? 'SCAR_RELATED_VT' : va === 'BUNDLE_BRANCH_REENTRY' ? 'BUNDLE_BRANCH_REENTRY_VT' : undefined };
  const ind = String(one('DEVICE_IMPLANTS')?.implant_indication ?? '');
  if (ind === 'SND' || ind === 'AV_BLOCK') return { dx: ind };
  if (ind === 'AF_BRADY') return { dx: 'AF' };
  return null;
}

const CSP_TARGET: Record<string, string> = { HBP: 'HIS', HOT_CRT: 'HIS', LBBAP: 'LEFT_BUNDLE_BRANCH_AREA', LOT_CRT: 'LEFT_BUNDLE_BRANCH_AREA', BIV_CRT: 'NOT_APPLICABLE' };

export interface DeriveContext {
  caseId: string;
  episodeId: string;
  patientId: string;
  /** Slot id of a one-per-scope section (same ids as the server's expectedSlot). */
  slot: (entity: string, scopeId: string) => string;
  season: HajjSeason;
}

/** Everything the app fills for this case now, as changes that differ from what is stored. */
export function deriveChanges(dict: Dictionary, rows: Rows, ctx: DeriveContext): Derived[] {
  const out: Derived[] = [];
  const want = (entity: string, row: DecodedRow | null | undefined, field: string, value: unknown, opts: { onlyIfEmpty?: boolean; create?: { id: string; parent_id: string | null } } = {}) => {
    if (!dict.entities[entity]?.fields.some((f) => f.name === field)) return;
    const cur = row?.[field];
    if (opts.onlyIfEmpty && hasValue(cur)) return;
    if (value === null || value === undefined) {
      if (!opts.onlyIfEmpty && row && hasValue(cur)) out.push({ entity, id: row._id, field, value: null });
      return;
    }
    if (JSON.stringify(cur ?? null) === JSON.stringify(value)) return;
    if (row) out.push({ entity, id: row._id, field, value });
    else if (opts.create) out.push({ entity, id: opts.create.id, field, value, create: { parent_id: opts.create.parent_id } });
  };

  const episode = rows('EP_EPISODES').find((r) => r._id === ctx.episodeId) ?? rows('EP_EPISODES')[0];
  const patient = rows('PATIENTS').find((r) => r._id === ctx.patientId) ?? rows('PATIENTS')[0];
  const ident = rows('PATIENT_IDENTIFIERS')[0];
  const procs = rows('EP_PROCEDURES');
  const snapshot = rows('CLINICAL_PROFILE_SNAPSHOTS')[0];
  const device = rows('DEVICES')[0];

  // Procedures: date defaults to the episode date (one date, owner); type from the ticks; links.
  for (const p of procs) {
    if (episode) want('EP_PROCEDURES', p, 'procedure_start_datetime', episode.episode_start_date ?? null, { onlyIfEmpty: true });
    const types = rows('PROCEDURE_COMPONENTS').filter((c) => c.procedure_id === p._id).map((c) => String(c.component_type));
    const implant = rows('DEVICE_IMPLANTS').find((r) => r.procedure_id === p._id) ?? {};
    const lead = rows('LEAD_PROCEDURES').find((r) => r.procedure_id === p._id) ?? {};
    if (types.length) want('EP_PROCEDURES', p, 'primary_procedure_type', procedureType(types, { device_action: (implant as DecodedRow).device_action, lead_management_type: (lead as DecodedRow).lead_management_type }));
    if (snapshot) want('EP_PROCEDURES', p, 'baseline_clinical_snapshot_id', snapshot._id, { onlyIfEmpty: true });
    const csp = rows('CRT_CSP_PROCEDURES').find((r) => r.procedure_id === p._id);
    if (csp && hasValue(csp.cpp_strategy)) want('CRT_CSP_PROCEDURES', csp, 'csp_target', CSP_TARGET[String(csp.cpp_strategy)] ?? null);
    if (device) {
      if (csp) want('CRT_CSP_PROCEDURES', csp, 'device_id', device._id, { onlyIfEmpty: true });
      const avj = rows('AVJ_ABLATIONS').find((r) => r.procedure_id === p._id);
      if (avj && ['YES_EXISTING_SYSTEM', 'YES_IMPLANTED_SAME_SESSION'].includes(String(avj.functioning_pacing_system_confirmed_preablation))) want('AVJ_ABLATIONS', avj, 'pacing_system_device_id', device._id, { onlyIfEmpty: true });
    }
  }

  // Studies link to this episode, and to the only procedure when there is just one (owner: chooser only for 2+).
  const only = procs.length === 1 ? procs[0]._id : null;
  for (const e of ['ECG_STUDIES', 'LAB_RESULTS', 'MEDICATION_RECORDS', 'ECHO_STUDIES', 'RHYTHM_MONITORING', 'ADVANCED_IMAGING', 'CORONARY_ANGIOGRAPHY', 'TILT_TESTS', 'CLINICAL_PROFILE_SNAPSHOTS']) {
    for (const r of rows(e)) {
      if (episode) want(e, r, 'episode_id', episode._id, { onlyIfEmpty: true });
      if (only) want(e, r, 'procedure_id', only, { onlyIfEmpty: true });
    }
  }
  // The latest echo before or on the procedure is its baseline echo.
  const echoes = rows('ECHO_STUDIES').filter((r) => hasValue(r.echo_date)).sort((a, b) => String(b.echo_date).localeCompare(String(a.echo_date)));
  for (const e of ['AF_ABLATIONS', 'VENTRICULAR_ABLATIONS', 'CRT_CSP_PROCEDURES']) {
    for (const r of rows(e)) {
      const day = String(procs.find((p) => p._id === r.procedure_id)?.procedure_start_datetime ?? '9999').slice(0, 10);
      const echo = echoes.find((x) => String(x.echo_date) <= day);
      if (echo) want(e, r, 'baseline_echo_id', echo._id, { onlyIfEmpty: true });
    }
  }

  // Hajj timing from the first procedure's date (or the episode date) and the pilgrim status.
  if (episode) {
    const dates = procs.map((p) => String(p.procedure_start_datetime ?? '')).filter((d) => d.length >= 10).sort();
    const date = dates[0] ?? (episode.episode_start_date as string | null) ?? null;
    want('EP_EPISODES', episode, 'hajj_timing', hajjTiming(date, episode.pilgrim_status, ctx.season));
  }

  // Diagnosis from the first procedure that says one (only into empty answers).
  for (const p of procs) {
    const types = rows('PROCEDURE_COMPONENTS').filter((c) => c.procedure_id === p._id).map((c) => String(c.component_type));
    const d = diagnosisOf(rows, p._id, types);
    if (!d) continue;
    const ind = rows('ARRHYTHMIA_INDICATIONS')[0];
    const slot = ctx.slot('ARRHYTHMIA_INDICATIONS', ctx.caseId);
    want('ARRHYTHMIA_INDICATIONS', ind, 'primary_ep_diagnosis', d.dx, { onlyIfEmpty: true, create: { id: slot, parent_id: null } });
    const dx = ind?.primary_ep_diagnosis ?? d.dx;
    if (d.sub && dx === d.dx) want('ARRHYTHMIA_INDICATIONS', ind, 'diagnosis_subtype', d.sub, { onlyIfEmpty: true, create: { id: slot, parent_id: null } });
    break;
  }

  // eGFR from creatinine, age at the lab date and sex.
  for (const lab of rows('LAB_RESULTS')) {
    if (!hasValue(lab.creatinine_umol_l)) continue;
    const v = egfr(lab.creatinine_umol_l, ageOn(ident?.date_of_birth, lab.lab_date), patient?.sex_at_birth);
    if (v !== null) want('LAB_RESULTS', lab, 'egfr_ml_min_1_73m2', v);
  }

  // Device implant date precision from what was typed.
  if (device) want('DEVICES', device, 'implant_date_precision', hasValue(device.implant_date) ? 'EXACT_DATE' : hasValue(device.implant_year) ? 'YEAR_ONLY' : null);
  return out;
}

/** Fields the app writes itself: allowed through the server even when hidden or read-only on the form. */
export const DERIVED_FIELDS = new Set([
  'EP_PROCEDURES.procedure_start_datetime',
  'EP_PROCEDURES.primary_procedure_type',
  'EP_PROCEDURES.baseline_clinical_snapshot_id',
  'CRT_CSP_PROCEDURES.csp_target',
  'CRT_CSP_PROCEDURES.device_id',
  'AVJ_ABLATIONS.pacing_system_device_id',
  'EP_EPISODES.hajj_timing',
  'ARRHYTHMIA_INDICATIONS.primary_ep_diagnosis',
  'ARRHYTHMIA_INDICATIONS.diagnosis_subtype',
  'LAB_RESULTS.egfr_ml_min_1_73m2',
  'DEVICES.implant_date_precision',
]);
