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

## Step 2 (live 28 Oct, Worker bfad336f)
Case card: MRN first and big · age/sex · Hajj/Umrah mark · date small on the right · "N missing" instead of core x/y.
List: quick periods (This month / Last 3 months / Hajj season), status (All / In progress / Completed), order (Newest /
Oldest / Most missing); a colored dot per group on the tabs and cards; "+ group" moved to Settings (Groups); a Member
with one group sees no tabs; + is a floating button on phones that opens New case / Bulk add MRNs (Admin only).
"Hajj season <year>" also added to the menu's Period list (1 Dhu al-Qa'dah → 15 Muharram).

## Step 3 preview (approved 28 Oct): https://claude.ai/artifact/Ld4BVxmXShvzcdqvg9G7uU
Owner changes on the preview: "Others" last, after Medications, with no Tilt label outside; AI Assistant as a small
icon in the tools row (AI · Cohorts · History · Report); "Baseline risk profile" renamed **Medical History**; Cohorts
keep their name. Builder defaults accepted: no helper line, wide Create case, MRN prompt with the last case + Open this
case / New case for this patient, "What's missing?" instead of "Ready to complete?".

## Step 3 (live 28 Oct, Worker bb82cd72)
Built as the preview, with these builder notes:
- Follow-up is one row, "Follow-up visits & events" (the existing follow-up screen holds both); the preview showed two rows.
- Device interrogation is always listed (owner's order of Investigations); before, it showed only with a device.
- TEE, Cardiac CT and CMR are one dictionary entity (ADVANCED_IMAGING, modality_code); the layout row's new `values`
  key shows each as its own section. The AI Assistant and the case report see the entity once.
- The "Unusual MRN prefix" warning is no longer shown in New Case (round 1: drop or change it); Bulk add keeps it.
- A procedure added and then cancelled asks before it is discarded once its type was chosen.
- 5 choices or fewer are buttons; more open a list on the question's line (e.g. AF energy source is now a list).
Owner edits on the preview (28 Oct, later): heading "Investigations & Medications"; the Patient & episode sheet is titled
"Patient Demographics"; Referring service off the form (it already was, field review); Male before Female (already so).

## Step 4 (live 28 Oct, Worker 9d50f4e9): https://claude.ai/artifact/RpV8FfXyD57sArrPvCyuL5
Procedure sheet: title = the procedure's real name; on top, fixed while scrolling: date · N missing, "DONE:" with the
ticked items and Edit (the ticks stay open for a procedure just added), and tabs General · each type · Complications
with their missing counts. A tab jumps to its part (all parts stay on one page, so nothing is hidden) and follows the
scroll. Parts open and close: Procedure details, Mapping & access (builder's grouping of mapping / ICE / transseptal /
contrast questions), one per type module, Complications. "Not available" is a small icon beside an empty core
question; its dialog keeps the four ready reasons and "another reason".
Not changed: questions that do not apply are shown or hidden by the existing rules (e.g. accessory-pathway questions
still show under SVT ablation for AVNRT, as before).


## Step 5 (live 29 Oct, Worker 496eaa5c): https://claude.ai/artifact/3qxYL1dxu64Xy9xQB1j9jP
Preview approved as drawn ("build it"). Owner answers on the preview: a Member does **not** see Cohorts (Dashboard tab
stays Admin only; a Member's tabs are My work · Cases · Follow-up · Settings); the Follow-up tab is switched on for
everyone (`config/site.json` `followup_due.enabled: true`). Owner's edit on the canvas: the patient page lists
**procedures** ("Procedures you can see"), one row per procedure.
- Tabs: My work · Cases · Follow-up (red number = overdue + due within 7 days) · Dashboard (Admin) · Settings. No
  Patients tab; the bell on the Cases screen is gone (the tab replaces it). Opening the app lands on My work.
- My work: "Done this week" = cases the user marked Completed since Sunday (Riyadh time), Open, Ready; open cases with
  the fewest missing first (same count as the case card); not-started cases show "Not started".
- Follow-up tab: Overdue / This week / Later (90 days), filter All / Visits / Device checks, device type on device checks.
- Menu: Ablation, Devices, **Structural, Diagnostic** (order changed in `config/categories.json`); several items at once
  (a tick on each picked item); Cohorts moved to the Dashboard; your name at the bottom opens Settings (My account).
- Dashboard: Cohorts panel on top (same items, edit, New cohort, Hidden cohorts); picking a cohort changes the numbers;
  "Show these N cases" opens the Cases list with that cohort as a filter chip.
- Patient page: from the MRN in the case header or a "Patient …" row in search (3+ digits); device next to the MRN.
- Desktop with no case open: big New case (Admin), or Bulk add; your open cases (top 5); follow-ups this week.


## Step 6 (built 29 Oct, NOT deployed; paused by the owner): https://claude.ai/artifact/95pdJVfnbSoYqjHougXeT8
Preview approved ("build it"). Owner answers: a moved case gets a **new number** in the new group (old one in History);
Bulk add's procedure type is **for filtering only** — kept as an operational "planned" mark (Cases column
`planned_type`, a PROCEDURE_COMPONENTS.component_type code), shown as "AF (planned)" and matched by the menu until a
real procedure exists; no procedure is opened.
- Settings: My account; Appearance on this device (Light / Dark / Auto, text size Small / Normal / Large / Larger);
  Default group (New case and Bulk add start on it; kept per user on the device); Admin link; Excel export; About.
- Admin page `#/admin`: Users (Reset password + Share, Admin may have no group = supervisor), Groups, Recycle bin,
  Activity log, AI Assistant show / hide switch (`/api/settings/ui`, `features.ai`), AI provider.
- Case screen: Move tool (Admin, more than one group) → `POST /api/cases/:id/move`.
- Sign-in: navy band with the name, labelled boxes, wide button.
Left to do before deploy: run `npm run e2e:worker` (not run yet), add the Sheet column with
`node scripts/sheets.ts setup --test` then `node scripts/sheets.ts setup`, then deploy on the owner's yes.
Tests run: unit/server 245 passed, e2e 80 passed.
