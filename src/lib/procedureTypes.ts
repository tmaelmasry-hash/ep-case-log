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

// Owner field review (24 Oct 2026, phase 2): one list of what was done. Each item ticks dictionary components; the
// procedure type follows from them (shared/derive.ts). Device items that share Device implant are told apart by
// the case device type, the CRT/CSP strategy or the device action; until those are answered, the tick made on this
// screen is remembered on this device.
export interface ProcedureItem {
  id: string;
  label: string;
  group: 'Ablation' | 'Devices' | 'Other';
  components: string[];
  /** Device types offered for the case device when this item is ticked. */
  deviceTypes?: string[];
  /** Answer set when the item is ticked (only into an empty answer). */
  preset?: { entity: string; field: string; value: string };
}

const PPM = ['PPM_SINGLE', 'PPM_DUAL', 'LEADLESS_SINGLE', 'LEADLESS_DUAL'];
const ICD = ['ICD_SINGLE', 'ICD_DUAL', 'S_ICD', 'EV_ICD'];
const CRT = ['CRT_P', 'CRT_D'];
/** Owner 30 Oct: Leadless LVEP and CCM (M3-H7 codes) under one "Other device" tick. */
const OTHER_DEVICE = ['LEADLESS_LVEP', 'CCM', 'OTHER'];

export const PROCEDURE_ITEMS: ProcedureItem[] = [
  { id: 'AF', label: 'AF', group: 'Ablation', components: ['AF'] },
  { id: 'FLUTTER', label: 'Flutter', group: 'Ablation', components: ['FLUTTER'] },
  { id: 'AVNRT', label: 'AVNRT', group: 'Ablation', components: ['AVNRT'] },
  { id: 'AP', label: 'Accessory pathway', group: 'Ablation', components: ['AVRT_WPW'] },
  { id: 'AT', label: 'AT / other SVT', group: 'Ablation', components: ['AT_SVT'] },
  { id: 'AVN', label: 'AV node', group: 'Ablation', components: ['AVJ_ABLATION'] },
  { id: 'PVC', label: 'PVC', group: 'Ablation', components: ['PVC'] },
  { id: 'VT', label: 'VT', group: 'Ablation', components: ['VT_VF'] },
  { id: 'PACEMAKER', label: 'Pacemaker', group: 'Devices', components: ['DEVICE_IMPLANT'], deviceTypes: PPM },
  { id: 'ICD', label: 'ICD', group: 'Devices', components: ['DEVICE_IMPLANT'], deviceTypes: ICD },
  { id: 'CRT', label: 'CRT', group: 'Devices', components: ['DEVICE_IMPLANT', 'CRT_CSP'], deviceTypes: CRT },
  { id: 'OTHER_DEVICE', label: 'Other device', group: 'Devices', components: ['DEVICE_IMPLANT'], deviceTypes: OTHER_DEVICE },
  { id: 'CSP', label: 'Conduction system pacing', group: 'Devices', components: ['DEVICE_IMPLANT', 'CRT_CSP'] },
  { id: 'GEN', label: 'Generator change / upgrade', group: 'Devices', components: ['DEVICE_IMPLANT'], preset: { entity: 'DEVICE_IMPLANTS', field: 'device_action', value: 'GENERATOR_CHANGE' } },
  { id: 'LEAD', label: 'Lead extraction / revision', group: 'Devices', components: ['LEAD_MANAGEMENT'] },
  { id: 'ILR', label: 'ILR', group: 'Devices', components: ['ILR'] },
  { id: 'EPS', label: 'EP study', group: 'Other', components: ['DIAGNOSTIC_EPS'] },
  { id: 'LAA', label: 'LAA closure', group: 'Other', components: ['LAA_CLOSURE'] },
];

export interface ItemFacts {
  components: string[];
  deviceType?: unknown;
  strategy?: unknown;
  deviceAction?: unknown;
  /** Items ticked on this device for this procedure (before the answers that tell them apart exist). */
  picked: string[];
}

/** Is this item ticked for the procedure? */
export function itemOn(item: ProcedureItem, f: ItemFacts): boolean {
  if (!item.components.every((c) => f.components.includes(c))) return false;
  const t = String(f.deviceType ?? '');
  const s = String(f.strategy ?? '');
  switch (item.id) {
    case 'PACEMAKER':
      return PPM.includes(t) || (!t && !f.components.includes('CRT_CSP') && f.picked.includes(item.id));
    case 'ICD':
      return ICD.includes(t) || (!t && !f.components.includes('CRT_CSP') && f.picked.includes(item.id));
    case 'CRT':
      return CRT.includes(t) || ['BIV_CRT', 'HOT_CRT', 'LOT_CRT'].includes(s) || (!s && !CRT.includes(t) && f.picked.includes(item.id));
    case 'OTHER_DEVICE':
      return OTHER_DEVICE.includes(t) || (!t && !f.components.includes('CRT_CSP') && f.picked.includes(item.id));
    case 'CSP':
      return ['HBP', 'LBBAP'].includes(s) || (!s && f.picked.includes(item.id));
    case 'GEN':
      return ['GENERATOR_CHANGE', 'UPGRADE', 'DOWNGRADE'].includes(String(f.deviceAction ?? '')) || (!f.deviceAction && f.picked.includes(item.id));
    default:
      return true;
  }
}

/** Components to remove when an item is unticked: its own ones that no other ticked item still needs. */
export function componentsToDrop(item: ProcedureItem, f: ItemFacts): string[] {
  const others = PROCEDURE_ITEMS.filter((x) => x.id !== item.id && itemOn(x, f)).flatMap((x) => x.components);
  return item.components.filter((c) => !others.includes(c));
}

/** The case device (type, manufacturer, leads) is entered inside a device procedure. */
export const showsDevice = (chosen: string[]) => chosen.some((c) => DEVICE_COMPONENTS.includes(c) || c === 'ILR');
export const showsLeads = (chosen: string[]) => chosen.some((c) => DEVICE_COMPONENTS.includes(c));
