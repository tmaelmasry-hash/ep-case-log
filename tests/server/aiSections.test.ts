// The screen's section ids must be the ones the server knows, each with fields the AI may fill.
import { describe, expect, it } from 'vitest';
import { aiSectionOf } from '../../shared/aiSections.ts';
import { aiFields, aiSections } from '../../server/ai/catalogue.ts';
import { config } from './harness.ts';

describe('AI line in a case section', () => {
  const known = aiSections(config.dict).map((s) => s.id);
  const rows = config.dict.layout.groups.flatMap((g) => g.rows);

  it('every section that gets a line is a section the server knows', () => {
    const got = rows.map((r) => [r.id, aiSectionOf(config.dict, r.entities)] as const);
    for (const [row, id] of got) if (id) expect(known, `row ${row}`).toContain(id);
    expect(got.filter(([, id]) => id).length).toBeGreaterThan(3);
  });

  it('rows that share a table use its first row; follow-up has no line, since the AI does not read it', () => {
    const shared = rows.filter((r) => r.values);
    if (shared.length > 1) expect(new Set(shared.map((r) => aiSectionOf(config.dict, r.entities))).size).toBe(1);
    expect(known).toContain('procedure');
    expect(known).not.toContain('followup');
    expect(aiSectionOf(config.dict, rows.find((r) => r.id === 'followup')!.entities)).toBeNull();
  });

  it('lists which sections have no field to fill', () => {
    const fields = [...aiFields(config.dict).values()];
    const empty = known.filter((id) => !fields.some((f) => f.section === id));
    expect(empty).toEqual([]);
  });
});
