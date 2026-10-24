// The dictionary in the browser: built from the same config files as the server (bundled at build time).
import { buildDictionary, type RawEntity } from '../../shared/dictionary.ts';
import extension from '../../config/dictionary/extension_entities.json';
import labels from '../../config/dictionary/labels.json';
import core from '../../config/dictionary/core_dataset.json';
import amendments from '../../config/dictionary/amendments.json';
import localAmendments from '../../config/local_amendments.json';
import rules from '../../config/rules.json';
import layout from '../../config/case_layout.json';
import site from '../../config/site.json';
import type { CaseLayout, CoreSpec } from '../../shared/dictionary.ts';
import type { MrnConfig } from '../../shared/mrn.ts';
import type { Amendments } from '../../shared/amendments.ts';
import type { RulesConfig } from '../../shared/rules.ts';

const files = import.meta.glob('../../config/dictionary/entities/*.json', { eager: true, import: 'default' }) as Record<string, RawEntity>;
const entities: Record<string, RawEntity> = {};
for (const [path, form] of Object.entries(files)) entities[path.split('/').pop()!.replace('.json', '')] = form;

export const dict = buildDictionary({
  entities,
  extension: extension as Record<string, unknown>,
  labels: labels as { fields: Record<string, string>; codes: Record<string, string> },
  layout: layout as unknown as CaseLayout,
  core: core as unknown as CoreSpec,
  amendments: amendments as unknown as Amendments,
  localAmendments: localAmendments as unknown as Amendments,
  rules: rules as unknown as RulesConfig,
});

export const mrnRules = (site as { mrn: MrnConfig }).mrn;

export function fieldOf(entity: string, field: string) {
  return dict.entities[entity].fields.find((f) => f.name === field)!;
}

/** Label of a dictionary code for ENTITY.field. */
export function label(entity: string, field: string, code: string | null | undefined): string {
  if (!code) return '';
  return fieldOf(entity, field)?.codes?.find((c) => c.code === code)?.label ?? code;
}
