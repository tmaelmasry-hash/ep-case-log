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

## Round 2 — main screen and everything not reviewed before (done 28 Oct)
Page: https://claude.ai/artifact/9UKoSumJY5q6FgyQJaEtPj — 32 of 32 answered: 31 "improve", 1 "later" (AI Assistant).

| Element | Picked | Owner note |
|---|---|---|
| Main top bar | Bulk add moves inside the + button (New case / Bulk add); "Synced" shown once; + as a big floating button | "The add-cases button shows for the Admin only" — ask: Bulk add only, or single cases too (plan A11 lets Members add a single case) |
| Screen title | smaller title | Rename to **"Registry Cases"** |
| Search | number pad on phones; last 5 opened cases | Remove search by case No. |
| Group tabs | a color per group; "+ group" moves to Settings; a Member with one group sees no tabs | — |
| Date filter | quick chips (This month / Last 3 months / Hajj season); In progress / Completed filter; sort choice | — |
| **Case card** | MRN first and big; age · sex; "N missing" instead of core x/y; Hajj/Umrah mark | Cases ordered by date, newest on top |
| Month headings | case count | Count inside a colored circle |
| Empty desktop pane | — (improve, no detail) | ask |
| Bottom tabs | add a Follow-up tab; drop the Patients tab | "What will the + button do?" (answered in chat). Patients list was also improved (below) — ask where it lives |
| Procedure categories | choose several at once | "Suggest the right order" |
| Cohorts | fix the Pilgrims count; move cohorts to the Dashboard | "Explain what a cohort is; suggest a simpler name" |
| Period | add "Hajj season" | — |
| Menu footer | tap your name → account | — |
| Procedure sheet | two steps (choose, then Next); a tab per ticked type; collapsible sections with missing counts; ticks row stays visible | — |
| "Not available…" | small icon; ready reasons to pick | — |
| Ready to complete? | — | Keep it to jump straight to the missing fields; rename or suggest something else |
| AI Assistant | later | Suggest a small AI button in each section, used for that section only |
| Case report | WhatsApp share (text, no patient name) | The Share button opens choices |
| Follow-ups due | change the window | **90 days** |
| Patients | device (PPM / ICD / CRT) next to the MRN | — |
| My work | first screen on opening; fewest-missing first; "done this week" | — |
| Dashboard numbers | change "Stale"; cases-by-month chart | "Explain Stale first" (In progress and untouched for 14 days) — ask the number |
| Dashboard clinical | Hajj season vs rest of year; charts; Excel export of the tables | — |
| My account | Light / Dark choice; default group | "An Admin may have a group, or be a supervisor only" |
| Admin and users | move cases between groups; Reset password per user; a separate Admin page | — |
| Excel export | choose a period | "Mostly for statistics: complete and ready to use; suggest or ask" |
| AI provider | hide it | A switch in Settings to show or hide it |
| Sign-in | cluster colors and a clearer screen | — |
| Bulk add | choose the group; one procedure type for the whole list | — |
| Colors | review procedure-type colors; review Dark mode | — |
| Text | a bit bigger everywhere; each user picks a size | — |
| Messages | Undo instead of a delete confirm; messages at the top | — |

**Pilgrims count (checked 28 Oct):** not a data error. "Pilgrims" is the parent of Hajj / Umrah / Non-pilgrim /
Not recorded in `config/categories.json`, and a parent counts every case in its children, so the 4 cases with no
pilgrim status were counted under "Pilgrims". Fix (owner picked it): the parent counts only Hajj + Umrah; Non-pilgrim and
Not recorded stay as their own lines.

## Build plan (proposed 28 Oct; each step: preview → owner yes → build → tests → deploy on yes)
1. **Quick fixes, no new look (built and live 28 Oct, Worker fbaf4dc7):** Pilgrims count; follow-ups window 90 days; remove search by No.; "Synced" once; title
   "Registry Cases"; month count in a colored circle; cases newest first.
2. **Case card and main list:** new card (MRN big, age · sex, N missing, Hajj mark); date chips, status filter, sort;
   group colors; + as a floating button with New case / Bulk add.
3. **New Case and case screen (round 1):** one procedure date per procedure; choose types first; MRN as title; header
   card; Investigations / Follow-up split; Notes; Save Draft; "Select" on the same line.
4. **Procedure sheet:** two steps, a tab per type, collapsible sections, "Not available" icon with reasons, missing-fields jump.
5. **Navigation:** Follow-up tab, Patients tab decision, My work first, cohorts to the Dashboard, menu footer.
6. **Settings and Admin:** separate Admin page, move cases, Reset password, default group, Light / Dark, text size,
   AI section switch, sign-in look, Bulk add with group and type.
7. **Dashboard and export:** charts, Hajj season split, table export, Stale days, stats-ready Excel with a period.
8. **Look:** procedure-type colors, Dark mode, bigger text, Undo messages at the top.

## Owner answers, 28 Oct (after round 2)
- **Only the Admin adds cases** (single or bulk). Members fill in and edit cases of their groups. Changes plan A11
  (`server/auth/capabilities.ts`). A case nobody has filled in yet shows in **My work** of every Member of its group;
  the first person who saves in it becomes its collector.
- Bottom tab: builder's choice → **"Cases"** (matches the "Registry Cases" title).

## Step 2 (built locally 28 Oct, preview shown, waiting for the owner's yes)
Case card: MRN first and big · age/sex · Hajj/Umrah mark · date small on the right · "N missing" instead of core x/y.
List: quick periods (This month / Last 3 months / Hajj season), status (All / In progress / Completed), order (Newest /
Oldest / Most missing); a colored dot per group on the tabs and cards; "+ group" moved to Settings (Groups); a Member
with one group sees no tabs; + is a floating button on phones that opens New case / Bulk add MRNs (Admin only).
"Hajj season <year>" also added to the menu's Period list (1 Dhu al-Qa'dah → 15 Muharram).
