# Source of these files

Copied unchanged from the owner's EP Workspace repository (zip `EP_Workspace_source_2026-10-21.zip`, commit `ff48639`):

| Here | EP Workspace |
|---|---|
| `entities/*.json` (37) | `config/forms/entities/*.json` — generated there by `npm run gen:forms` from `dictionary/form_schema.json` |
| `extension_entities.json` | `config/forms/extension_entities.json` (operational, not clinical: EXT_PROCEDURE_REVIEW) |
| `labels.json` | `config/labels.json` (display-label corrections only) |
| `core_dataset.json` | `config/core_dataset.json` (core fields; used for the ★ marks now, readiness in phase 3) |

Rules: never edit these by hand and never add clinical fields or codes. To update, regenerate in EP Workspace and copy again.
The case layout for this app (case = episode, several procedures) is in `config/case_layout.json`, which only arranges these entities.
