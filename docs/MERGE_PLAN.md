# Merge plan: EP Workspace features into EP Case Log

Owner decisions (Dr. Tarek, 21 Oct 2026, step 2 multiple-choice). Source read: `EP_Workspace_source_2026-10-21.zip` (commit `ff48639`), read only, never run.

## Decisions
| # | Decision |
|---|---|
| D1 | Code base: **EP Case Log** (React + TypeScript). Owner chose this over the recommended "start from EP Workspace code" after the trade-off was explained (more work, higher risk). |
| D2 | Runtime: **same system as EP Workspace** — server, username sign-in, Admin/Member, groups, Google Sheet via Apps Script, Cloudflare. Portable EP Workspace parts (domain rules, dictionary forms/config, tests) are ported, not rewritten from memory. |
| D3 | Clinical fields: **dictionary only**. EP Case Log's own procedure/complication/CHA input fields are removed and replaced by dictionary entities and codes. Nothing invented. |
| D4 | Case model: **case = EP_EPISODE** with one or more `EP_PROCEDURES` (dictionary hierarchy PATIENT → EP_EPISODES → EP_PROCEDURES; each procedure keeps its `PROCEDURE_COMPONENTS`). Replaces EP Workspace A7 (one case = one procedure). Readiness, categories, dashboard and Sheet layout must handle several procedures per case. |
| D5 | Real EP Workspace data: **one-time copy at the very end**, rehearsed on synthetic data first, real import only with explicit owner approval. The live registry is never modified. |
| D6 | Kept from EP Case Log: **Patients screen**, **CHA₂DS₂-VASc display** computed from dictionary fields (`CLINICAL_PROFILE_SNAPSHOTS` heart_failure, hypertension, diabetes, prior_stroke_tia_systemic_embolism, vascular_disease + age + sex_at_birth), never stored. **PDF case report** kept, rebuilt on dictionary fields (saved values only, no generated wording). |
| D7 | Removed from EP Case Log: images, op-note scan, image inbox, its own sync server / local-only mode, invented fields. |
| D8 | Brought from EP Workspace: Bulk add MRNs, AI Assistant, MRN prompt + copy-forward, Light follow-up, Excel export, Dashboard + My work, Follow-up bell (built switched off, as in F-19). Not brought: Reports templates + WhatsApp. |
| D9 | Accounts/hosting for the new Sheet and site: **decided before phase 4**. Phases 1–3 run on a local store with synthetic data. |

## Build order (owner approved)
1. Server, sign-in, Admin/Member
2. Dictionary forms, case = episode with several procedures, remove old fields
3. Groups + numbering, readiness, Completed/Reopen, Not available, history, recycle bin, activity log
4. New Google Sheet via Apps Script (owner account steps)
5. MRN prompt + copy-forward
6. Bulk add MRNs
7. Light follow-up
8. Patients + CHA₂DS₂-VASc display
9. Dashboard + My work
10. Excel export
11. AI Assistant (needs API key)
12. Follow-up bell (off)
13. One-time copy of real EP Workspace data (explicit approval)

## Working rules
- Stop after each step; previews (screenshots) before building anything visible; multiple-choice questions.
- Fake data only in tests; never copy secrets; ask before anything that could change or lose real data.
- Replies to the owner in Egyptian Arabic; code and technical terms in English.
