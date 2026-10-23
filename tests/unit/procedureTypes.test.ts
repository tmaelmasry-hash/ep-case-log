// R3-1: procedure type → offered components, auto-ticked component, device sections.
import { describe, expect, it } from 'vitest';
import { componentToTick, offeredComponents, showsDevice, showsLeads } from '../../src/lib/procedureTypes';

const ALL = ['DIAGNOSTIC_EPS', 'AVNRT', 'AVRT_WPW', 'AT_SVT', 'AF', 'FLUTTER', 'PVC', 'VT_VF', 'AVJ_ABLATION', 'DEVICE_IMPLANT', 'CRT_CSP', 'LEAD_MANAGEMENT', 'ILR', 'OTHER', 'LAA_CLOSURE'];

describe('procedure types', () => {
  it('a CIED implant offers device components only and ticks Device implant', () => {
    expect(offeredComponents('CIED_IMPLANT', ALL, [])).toEqual(['DEVICE_IMPLANT', 'CRT_CSP', 'LEAD_MANAGEMENT']);
    expect(componentToTick('CIED_IMPLANT', [])).toBe('DEVICE_IMPLANT');
    expect(componentToTick('CIED_IMPLANT', ['CRT_CSP'])).toBeNull();
  });
  it('an ablation offers ablation components (+ EPS) and ticks nothing', () => {
    expect(offeredComponents('ABLATION', ALL, [])).not.toContain('DEVICE_IMPLANT');
    expect(offeredComponents('ABLATION', ALL, [])).toContain('AF');
    expect(componentToTick('ABLATION', [])).toBeNull();
  });
  it('keeps a component already chosen, and offers everything for Other or no type', () => {
    expect(offeredComponents('ABLATION', ALL, ['ILR'])).toContain('ILR');
    expect(offeredComponents('OTHER', ALL, [])).toEqual(ALL);
    expect(offeredComponents(null, ALL, [])).toEqual(ALL);
  });
  it('device and leads sections follow the device components', () => {
    expect(showsDevice(['ILR'])).toBe(true);
    expect(showsLeads(['ILR'])).toBe(false);
    expect(showsLeads(['LEAD_MANAGEMENT'])).toBe(true);
    expect(showsDevice(['AF'])).toBe(false);
  });
});
