// Device pathway tag (owner Q-P1, 31 Oct; NCDR ICD / PPM v3.0 #15826): ICD, Pacemaker or Leads only, worked out from
// the case device type and the procedures. Display only: nothing is stored or asked.

export type Pathway = 'ICD' | 'Pacemaker' | 'Leads only';

const ICD_TYPES = ['ICD_SINGLE', 'ICD_DUAL', 'CRT_D', 'S_ICD', 'EV_ICD'];
/** Leadless LVEP and CCM are on the NCDR PPM form (#15794). */
const PACEMAKER_TYPES = ['PPM_SINGLE', 'PPM_DUAL', 'CRT_P', 'LEADLESS_SINGLE', 'LEADLESS_DUAL', 'LEADLESS_LVEP', 'CCM'];
const DEVICE_COMPONENTS = ['DEVICE_IMPLANT', 'CRT_CSP'];
const DEVICE_PROCEDURE_TYPES = ['CIED_IMPLANT', 'GENERATOR_CHANGE'];
const LEAD_PROCEDURE_TYPES = ['LEAD_REVISION', 'EXTRACTION'];

export interface PathwayProcedure {
  type: string | null;
  components: string[];
}

/** ILR, Other, a device type not chosen yet, or a case without device or lead procedures: no tag. */
export function devicePathway(deviceType: string | null | undefined, procedures: PathwayProcedure[]): Pathway | null {
  const device = procedures.some((p) => p.components.some((c) => DEVICE_COMPONENTS.includes(c)) || DEVICE_PROCEDURE_TYPES.includes(p.type ?? ''));
  if (device) return ICD_TYPES.includes(deviceType ?? '') ? 'ICD' : PACEMAKER_TYPES.includes(deviceType ?? '') ? 'Pacemaker' : null;
  const leads = procedures.some((p) => p.components.includes('LEAD_MANAGEMENT') || LEAD_PROCEDURE_TYPES.includes(p.type ?? ''));
  return leads ? 'Leads only' : null;
}

/** The case device type from a case summary's case-level codes ("DEVICES.current_device_type=CODE"). */
export function deviceTypeOf(codes: string[] | undefined): string | null {
  const k = (codes ?? []).find((x) => x.startsWith('DEVICES.current_device_type='));
  return k ? k.slice(k.indexOf('=') + 1) : null;
}
