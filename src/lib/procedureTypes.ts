// Owner decision R3-1 (23 Oct 2026): the primary procedure type decides which components a procedure offers,
// and ticks the obvious one, so a device procedure opens device sections only. Dictionary codes only.
export const ABLATION_COMPONENTS = ['AVNRT', 'AVRT_WPW', 'AT_SVT', 'AF', 'FLUTTER', 'PVC', 'VT_VF', 'AVJ_ABLATION'];
export const DEVICE_COMPONENTS = ['DEVICE_IMPLANT', 'CRT_CSP', 'LEAD_MANAGEMENT'];

const TYPE_COMPONENTS: Record<string, { offer: string[]; tick?: string }> = {
  EPS: { offer: ['DIAGNOSTIC_EPS'], tick: 'DIAGNOSTIC_EPS' },
  ABLATION: { offer: [...ABLATION_COMPONENTS, 'DIAGNOSTIC_EPS'] },
  CIED_IMPLANT: { offer: DEVICE_COMPONENTS, tick: 'DEVICE_IMPLANT' },
  GENERATOR_CHANGE: { offer: DEVICE_COMPONENTS, tick: 'DEVICE_IMPLANT' },
  LEAD_REVISION: { offer: DEVICE_COMPONENTS, tick: 'LEAD_MANAGEMENT' },
  EXTRACTION: { offer: DEVICE_COMPONENTS, tick: 'LEAD_MANAGEMENT' },
  ILR: { offer: ['ILR'], tick: 'ILR' },
  LAA_CLOSURE: { offer: ['LAA_CLOSURE'], tick: 'LAA_CLOSURE' },
};

/** Components to offer for a procedure type (all of them for Other or no type), keeping any already chosen. */
export function offeredComponents(type: unknown, all: string[], chosen: string[]): string[] {
  const t = typeof type === 'string' ? TYPE_COMPONENTS[type] : undefined;
  if (!t) return all;
  return all.filter((c) => t.offer.includes(c) || chosen.includes(c));
}

/** The component to tick when the type is chosen: only when none of that type's components is chosen yet. */
export function componentToTick(type: unknown, chosen: string[]): string | null {
  const t = typeof type === 'string' ? TYPE_COMPONENTS[type] : undefined;
  if (!t?.tick || chosen.some((c) => t.offer.includes(c))) return null;
  return t.tick;
}

/** The case device (type, manufacturer, leads) is entered inside a device procedure. */
export const showsDevice = (chosen: string[]) => chosen.some((c) => DEVICE_COMPONENTS.includes(c) || c === 'ILR');
export const showsLeads = (chosen: string[]) => chosen.some((c) => DEVICE_COMPONENTS.includes(c));
