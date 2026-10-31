// Device pathway tag (owner Q-P1, 31 Oct; NCDR #15826).
import { describe, expect, it } from 'vitest';
import { devicePathway, deviceTypeOf } from '../../shared/pathway.ts';

const implant = [{ type: 'CIED_IMPLANT', components: ['DEVICE_IMPLANT'] }];

describe('devicePathway', () => {
  it('ICD for ICD-capable systems, Pacemaker for the others (leadless, LVEP and CCM included)', () => {
    for (const t of ['ICD_SINGLE', 'ICD_DUAL', 'CRT_D', 'S_ICD', 'EV_ICD']) expect(devicePathway(t, implant), t).toBe('ICD');
    for (const t of ['PPM_SINGLE', 'PPM_DUAL', 'CRT_P', 'LEADLESS_SINGLE', 'LEADLESS_DUAL', 'LEADLESS_LVEP', 'CCM']) expect(devicePathway(t, implant), t).toBe('Pacemaker');
    expect(devicePathway('PPM_DUAL', [{ type: 'GENERATOR_CHANGE', components: [] }])).toBe('Pacemaker');
  });

  it('no tag for ILR, Other, no device type yet, or a case without device or lead procedures', () => {
    for (const t of ['ILR', 'OTHER', null]) expect(devicePathway(t, implant), String(t)).toBeNull();
    expect(devicePathway('ICD_DUAL', [{ type: 'ABLATION', components: ['AF'] }])).toBeNull(); // an AF ablation in an ICD patient
  });

  it('Leads only for a lead procedure without a device implant; a device implant in the same case wins', () => {
    expect(devicePathway(null, [{ type: 'EXTRACTION', components: ['LEAD_MANAGEMENT'] }])).toBe('Leads only');
    expect(devicePathway('ICD_DUAL', [{ type: 'LEAD_REVISION', components: [] }])).toBe('Leads only');
    expect(devicePathway('ICD_DUAL', [{ type: 'EXTRACTION', components: ['LEAD_MANAGEMENT'] }, ...implant])).toBe('ICD');
  });

  it('reads the device type from summary codes', () => {
    expect(deviceTypeOf(['EP_EPISODES.pilgrim_status=HAJJ', 'DEVICES.current_device_type=CRT_D'])).toBe('CRT_D');
    expect(deviceTypeOf(undefined)).toBeNull();
  });
});
