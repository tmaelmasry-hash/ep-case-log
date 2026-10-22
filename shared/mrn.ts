// MRN handling, ported from EP Workspace server/domain/mrn.ts. MRNs are text, never numbers. Rules: config/site.json.
export interface MrnConfig {
  normalize: string[];
  hard_rule: { regex: string; message: string };
  soft_rule: { regex: string; message: string };
}

export interface MrnCheck {
  value: string;
  ok: boolean;
  error?: string;
  warning?: string;
}

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

export function normalizeMrn(raw: string, cfg: MrnConfig): string {
  let s = raw;
  for (const step of cfg.normalize) {
    if (step === 'trim') s = s.trim();
    else if (step === 'arabic_indic_digits_to_ascii') s = s.replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)));
    else if (step === 'persian_digits_to_ascii') s = s.replace(/[۰-۹]/g, (d) => String(PERSIAN.indexOf(d)));
    else if (step === 'remove_inner_spaces_only_if_all_digits' && /^[\d\s]+$/.test(s)) s = s.replace(/\s+/g, '');
  }
  return s;
}

export function checkMrn(raw: string, cfg: MrnConfig): MrnCheck {
  const value = normalizeMrn(String(raw ?? ''), cfg);
  if (!new RegExp(cfg.hard_rule.regex).test(value)) return { value, ok: false, error: cfg.hard_rule.message };
  const warning = new RegExp(cfg.soft_rule.regex).test(value) ? undefined : cfg.soft_rule.message;
  return { value, ok: true, warning };
}
