// Which AI section a case section belongs to. Several screen rows can share a table (TEE, Cardiac CT and CMR share Imaging):
// the first row holding the table names the section, as in server/ai/catalogue.ts.
import type { Dictionary } from './dictionary.ts';

export function aiSectionOf(dict: Dictionary, entities: string[]): string | null {
  const owner = new Map<string, string>();
  for (const g of dict.layout.groups)
    for (const r of g.rows)
      for (const e of r.entities) if (dict.entities[e]?.scope !== 'procedure' && !owner.has(e)) owner.set(e, r.id);
  for (const e of entities) {
    const id = owner.get(e);
    if (id) return id;
  }
  return null;
}
