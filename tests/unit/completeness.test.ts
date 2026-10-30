// R4-8: completeness by case-page section, counted from the readiness checks only. Synthetic data.
import { describe, expect, it } from 'vitest';
import { completenessBySection, completenessKey } from '../../shared/completeness.ts';
import type { CheckState, CoreCheck } from '../../shared/readiness.ts';
import { evaluateReadiness } from '../../shared/readiness.ts';
import { loadConfig } from '../../server/dictionary.ts';

const groups = [
  {
    rows: [
      { id: 'patient', label: 'Patient & episode', icon: 'user', entities: ['PATIENTS'] },
      { id: 'labs', label: 'Labs', icon: 'flask', entities: ['LAB_RESULTS'] },
    ],
  },
];

const check = (entity: string, field: string, state: CheckState, procedure_id: string | null = null, section = 'patient'): CoreCheck => ({
  key: `${entity}.${field}${procedure_id ? `@${procedure_id}` : ''}`,
  entity,
  field,
  label: field,
  procedure_id,
  section: procedure_id ? 'procedure' : section,
  group: 'common',
  state,
  na_allowed: true,
});

describe('completenessBySection', () => {
  const checks = [
    check('PATIENTS', 'sex_at_birth', 'ok'),
    check('PATIENTS', 'nationality', 'not_available'),
    check('PATIENTS', 'residence_status', 'ai_pending'),
    check('PATIENTS', 'registry_basis', 'not_applicable'),
    check('EP_PROCEDURES', 'procedure_status', 'missing', 'p1'),
    check('EP_PROCEDURES', 'urgency', 'ok', 'p1'),
    check('EXT_PROCEDURE_REVIEW', 'complications_reviewed', 'missing', 'p1'),
  ];
  const r = completenessBySection(groups, checks, [{ id: 'p1', label: 'AF ablation' }]);

  it('lists layout rows, then each procedure and its complications', () => {
    expect(r.rows.map((x) => x.key)).toEqual(['s:patient', 's:labs', 'p:p1', 'c:p1']);
    expect(r.rows.map((x) => x.label)).toEqual(['Patient & episode', 'Labs', 'AF ablation', 'Complications']);
  });

  it('counts recorded, not available, missing and AI apart; not applicable is left out', () => {
    const pat = r.rows[0];
    expect(pat).toMatchObject({ recorded: 1, not_available: 1, missing: 0, ai: 1, total: 3 });
    expect(pat.fix?.field).toBe('residence_status');
    expect(r.rows[2]).toMatchObject({ recorded: 1, missing: 1, total: 2 });
    expect(r.rows[2].fix?.field).toBe('procedure_status');
    expect(r.rows[3]).toMatchObject({ missing: 1, total: 1 });
  });

  it('a section without core items has total 0 and nothing to fix', () => {
    expect(r.rows[1]).toMatchObject({ total: 0, recorded: 0, fix: null });
  });

  it('totals: answered = recorded + not available; AI is not answered', () => {
    expect(r.totals).toEqual({ recorded: 2, not_available: 1, missing: 2, ai: 1, total: 6 });
  });

  it('names complications by procedure when there are two procedures', () => {
    const two = completenessBySection(groups, [], [
      { id: 'a', label: 'Procedure 1' },
      { id: 'b', label: 'Procedure 2' },
    ]);
    expect(two.rows.filter((x) => x.kind === 'complications').map((x) => x.label)).toEqual(['Complications · Procedure 1', 'Complications · Procedure 2']);
  });

  it('puts complication entities of a procedure in its complications row', () => {
    expect(completenessKey(check('COMPLICATIONS', 'category', 'missing', 'p9'))).toBe('c:p9');
    expect(completenessKey(check('AF_ABLATIONS', 'energy_source', 'missing', 'p9'))).toBe('p:p9');
    expect(completenessKey(check('ECHO_STUDIES', 'lvef_percent', 'missing', null, 'echo'))).toBe('s:echo');
  });
});

describe('completeness agrees with readiness', () => {
  it('totals match evaluateReadiness on the real dictionary', () => {
    const { dict } = loadConfig();
    const rows = {
      EP_PROCEDURES: [{ _id: 'proc_1' }],
      PROCEDURE_COMPONENTS: [{ _id: 'comp_1', procedure_id: 'proc_1', component_type: 'AF' }],
      PATIENTS: [{ _id: 'pat_1', sex_at_birth: 'M' }],
    };
    const ready = evaluateReadiness(dict, rows, {});
    const c = completenessBySection(dict.layout.groups, ready.checks, [{ id: 'proc_1', label: 'Procedure 1' }]);
    expect(c.totals.total).toBe(ready.total);
    expect(c.totals.recorded + c.totals.not_available).toBe(ready.done);
    expect(c.rows.reduce((n, x) => n + x.total, 0)).toBe(ready.total);
    // Every row comes from the layout or the procedure: no stray section.
    expect(c.rows.every((x) => x.kind !== 'section' || dict.layout.groups.some((g) => g.rows.some((r) => r.id === x.section)))).toBe(true);
  });
});
