# Screen review (owner, 27–28 Oct 2026)

The owner reviews every screen element: keep / change / improve / later, picked suggestions, notes. Answers are kept in
each review page's database (collection `decisions`, one document per element). Nothing below is built yet; each
change gets a preview first (owner: "show me the look before you build").

## Round 1 — New Case sheet and case screen (done 28 Oct)
Page: https://claude.ai/artifact/8s835C3wVWiXxLW5MKomHF — 16 of 16 answered, all "improve".

| Element | Picked | Owner note |
|---|---|---|
| New Case header (Cancel · New Case · Create) | top button renamed "Create case" | — |
| MRN | live check of earlier cases while typing; drop / change the "Unusual MRN prefix" warning | — |
| Group | real group names; a color per group | Two groups by default, a button to add more when someone joins. A case lives in one group only. Admin can move cases between groups. A Member works only with own cases; full rights on all groups for Admin only. |
| Episode start date | Hijri date shown | One date = the procedure date; with several procedures each date sits next to its procedure. |
| Helper line | — (improve, no detail) | ask |
| Create case | — (improve, no detail) | ask |
| MRN-has-cases prompt | — (improve, no detail) | ask |
| Case top bar | MRN as the title instead of "Case" | — |
| Case header card | MRN big; age / sex; procedure chips; "N missing" instead of "Core fields x of y" | — |
| Procedures | real procedure name as title; ticked items as chips; big Add Procedure when empty | First a field to choose the procedure type without opening every procedure's fields; then open only the fields of the chosen ones. |
| Patient & history | merge Patient + Episode & pilgrimage; green tick when a section is complete | Rename suggestion for "Baseline risk profile" (ask which name). |
| Studies & follow-up | reorder; counts; show only filled + "Add" | Split into **Investigations** and **Follow-up**. Order: Labs, ECG, Holter, Device interrogation, Echocardiography, TEE, Cardiac CT, CMR, CAG ± PCI, Others (Tilt table test or anything else), Medications; then the Follow-up section. |
| Additional clinical information | rename to "Notes" | — |
| Case tools (AI, Cohorts, History, Report) | AI Assistant up under the header; the four as a row of icons | Show the look before building. |
| Bottom bar | hide it at the start of a case until a procedure is added | Add a **Save Draft** button. |
| "Select" on its own line (found in testing) | same line as the question; ≤5 choices as buttons | — |

## Round 2 — main screen and everything not reviewed before (open)
Page: https://claude.ai/artifact/9UKoSumJY5q6FgyQJaEtPj — 32 elements: main list (top bar, title, search, group tabs,
date filter, **case card**, month headings, empty desktop pane, bottom tabs), side menu (categories, cohorts, period,
footer), inside the case (procedure sheet layout, "Not available…", Ready to complete, AI Assistant, case report,
follow-ups due), Patients, My work, Dashboard (numbers, clinical counts), Settings (account, admin and users, Excel
export, AI provider, sign-in, Bulk add), overall look (colors, text size and language, messages).
Found while preparing it: the built-in "Pilgrims" cohort counted 4 test cases with no pilgrim status recorded — check.
