# Source of these files

Copied unchanged from the owner's EP Workspace repository (zip `EP_Workspace_source_2026-10-21.zip`, commit `ff48639`):

| Here | EP Workspace |
|---|---|
| `entities/*.json` (37) | `config/forms/entities/*.json` — generated there by `npm run gen:forms` from `dictionary/form_schema.json` |
| `extension_entities.json` | `config/forms/extension_entities.json` (operational, not clinical: EXT_PROCEDURE_REVIEW) |
| `labels.json` | `config/labels.json` (display-label corrections only) |
| `core_dataset.json` | `config/core_dataset.json` (core fields; used for the ★ marks now, readiness in phase 3) |

**Updated 23 Oct 2026 from EP Workspace commit `d84547d`** (owner approved bringing M-3, M-4a, M-4b and M-1):

| Here | EP Workspace |
|---|---|
| `core_dataset.json` | `config/core_dataset.json` — M-4a: stroke / TIA / thromboembolism replace the combined core item |
| `labels.json` | `config/labels.json` — old combined items marked "(old … item)" |
| `amendments.json` | `config/forms/amendments.json` — owner-approved local amendments M-3 (48 fields, 15 codes, LAA closure section), M-4a, M-4b; laid on top of the dictionary by `shared/amendments.ts` |
| `../rules.json` | `config/forms/rules.json` — M-1 dynamic-form rules (72), evaluated by `shared/rules.ts` |

Entity forms and `extension_entities.json` were compared: same content, nothing to copy.

Rules: never edit these by hand and never add clinical fields or codes. To update, regenerate in EP Workspace and copy again.
The case layout for this app (case = episode, several procedures) is in `config/case_layout.json`, which only arranges these entities.
