# Field review (owner, 24 Oct 2026)

The owner reviewed every case-form field (527 fields, 39 sections) on the private page **KAMC Field Review**
(https://claude.ai/artifact/Vxm8gc69gr5J3fuQgphLYr; decisions in its `decisions` collection, Claude's advice in
`advice`). Result: **363 keep · 164 remove · 0 later** (the 7 "Later" items were settled in the chat, see below).

## How it is built (phase 1)
- **The dictionary is not edited.** `config/case_layout.json` → `form` lays the review on top of it
  (`shared/dictionary.ts` `applyForm`, checked at start-up: unknown fields or codes stop the build):
  - `hidden` — the 164 removed fields: not on any form, not in Ready to complete, not offered to the AI, not printed,
    not copied forward. The Sheet keeps the column and saved values stay. A hidden **link** (fk) stays writable so
    the app can fill it (quick follow-up events now; auto-linked studies in phase 2).
  - `not_core` — shown, but no longer a core (★) item: Urgency (optional), Primary EP diagnosis, Diagnosis subtype,
    Device manufacturer (owner notes).
  - `labels` — Procedure date, Sex, Arrhythmia detected, Imaging modality, Indication of imaging.
  - `code_order` — Sex: Male, Female. Antiarrhythmic (medication, AF ablation, follow-up): None, Beta blocker only,
    Non-DHP CCB only, Amiodarone, then the rest.
  - `offer` — Procedure status: Completed / Partial / Failed. Monitor type: Holter, Mobile telemetry, ILR, CIED.
  - `date_only` — Procedure date (a time sent by an older device is cut to the date).
- `config/rules.json`: **DR-KAMC-01** First or redo only for ablation components. **DR-M3-E1** (V1 morphology) now
  follows CSP strategy LBBAP / LOT-CRT, because CSP target is hidden.
- A chosen Yes / No / Unknown (segmented control) is blue, like the pills (owner note, all fields).

## Conflicts with the dictionary (owner confirmed: hide from the form only)
51 removed fields are core (★) or R / RC in the dictionary. Core: Care setting, Discharge date, Hajj / Umrah timing.
Each is marked ★ or (R / RC) in the list below.

## Later items, settled in the chat
AF baseline echo and AVJ pacing system device: hidden, the app links them (phase 2). Date of last flutter ablation:
removed. Implant date precision: hidden, the app sets it (phase 2). Infection diagnostic certainty: removed.
Acute AF endpoint: kept (with PV status at case end). Imaging modality: kept, redesigned in phase 2.

## Removed (hidden) fields
- **Procedure** (15): Baseline clinical snapshot, Scheduled date, Procedure end datetime (RC), Cancellation or failure reason, Other procedure invasiveness, Care setting ★, Discharge date ★, Primary operator, Periprocedural anticoagulation strategy, Fluoroscopy used (RC), Fluoroscopy time, Dose area product, Contrast volume, Postprocedure disposition (RC), Procedure report reference
- **AF ablation** (12): Longest continuous AF duration, Modified EHRA symptom class (RC), Thrombus assessment imaging, Thrombus assessment date, Same day thrombus assessment completed before LA access, Baseline echo (RC), PVI block confirmation, Prior pharmacologic cardioversion (AF), Date of most recent surgical ablation, Prior pharmacologic cardioversion (flutter), Prior DC cardioversion (flutter), Date of most recent prior catheter ablation (flutter)
- **AV junction ablation** (1): Pacing system device (RC)
- **CRT / conduction-system pacing** (5): Device, Baseline echo, Baseline ECG (R), CSP target, CSP or LV lead
- **Device implant** (9): Prior device, Lower rate (RC), Tachytherapy status (RC), On heart transplant waiting list, Shared decision making, Shared decision-making tool used, Shared decision-making tool name, CABG date, PCI date
- **Leadless channel measurements** (1): Pulse width (RC)
- **Diagnostic EPS** (3): Mechanism identified (R), Baseline ah, Baseline hv
- **ILR procedure** (2): Prior device, Implant r wave
- **Lead revision / extraction** (1): Reimplant date
- **SVT ablation** (1): Endpoint confirmation
- **Ventricular ablation** (4): Baseline echo (RC), Baseline monitor, Baseline device, Mapping strategy (R)
- **Complication** (5): Invasive intervention required (R), Transfusion required (R), Unplanned ICU or life support (R), Permanent harm (R), Resolution date
- **Identifiers** (1): Full name (RC)
- **Registry & demographics** (3): Registry basis (R), Research study name, Patient ID in the study
- **Episode & pilgrimage** (5): Episode end date, Episode status (R), Referring service, Responsible EP clinician (RC), Hajj / Umrah timing ★
- **Diagnosis & indication** (6): Arrhythmia documented (R), Documentation modality, Symptom severity (R), Primary indication (R), Arrhythmia first diagnosis date, Prior AAD failed or intolerant count
- **Baseline risk profile** (7): Episode, Snapshot date (R), Snapshot context (R), Supersedes snapshot, Cardiomyopathy type (old single-choice item) (R), Prior stroke / TIA / systemic embolism (old combined item) (R), LV dysfunction
- **ECG** (4): Episode, Procedure, QTC method, Report reference
- **Lab result** (1): Troponin assay
- **Medication** (3): Episode, Parenteral anticoagulant (R), Antiarrhythmic dose
- **Echocardiography** (4): Episode, LA volume index, Structural diagnosis (RC), Report reference
- **Holter / rhythm monitoring** (5): Episode, End datetime (R), NSVT episode count, Longest VT, Report reference
- **CMR / CT / TEE** (9): Episode, Procedure, Result status (R), Noninterpretability or abort reason, Clinically actionable finding (R), Report reference, CMR RVEF, CMR structural diagnosis (RC), Lead vascular relationship high risk
- **Coronary angiography** (4): Episode, Procedure, Ischemic substrate relevance, Report reference
- **Tilt-table test** (5): Episode, Tilt result status (R), Tilt limitation reason, Planned followup date, Management consequence (R)
- **Device** (5): Implant date precision (R), Model (RC), Serial number, Remote monitoring enrolled (RC), Replacement device
- **Device infections** (4): Lead procedure, Infection diagnostic certainty (R), Blood culture result (R), Antibiotic course
- **Device checks** (9): Check type (R), Review period start status (R), Review period start datetime, Paced QRS, Channel assessment scope (R), Unlisted channels assessed normal, Next check due date, Event trigger, Report reference
- **Check channels** (4): Channel label, Pulse width, Trend flag (R), Channel action required (R)
- **Lead connections** (4): Lead (R), Connected from datetime (R), Connected to datetime, Connection procedure
- **Lead** (4): Lead origin (R), Implant procedure, Serial number, Pulse width (RC)
- **Lead status events** (3): Clinician confirmed same date order, Source device check, Source lead procedure
- **Follow-up visit** (5): Contact method (R), Rhythm monitor, Followup device check, Followup echo, Outcomes reviewed through date
- **Outcome event** (10): Followup, Same day event temporal relation, Hospitalization encounter reference, Episode duration, Duration assessment, Burden source monitor, Burden source device check, Linked procedure (RC), Linked complication, Linked device infection

## Phase 2 — behaviour (owner approved the preview 24 Oct; built, not yet deployed)
- **Procedure: "What was done"** (`src/lib/procedureTypes.ts` PROCEDURE_ITEMS, `ProcedureSheet`): 17 items in three
  groups (Ablation: AF, Flutter, AVNRT, Accessory pathway, AT / other SVT, AV node, PVC, VT · Devices: Pacemaker,
  ICD, CRT, Conduction system pacing, Generator change / upgrade, Lead extraction / revision, ILR · Other: EP study,
  LAA closure), right under the procedure date. Each item ticks its dictionary components and opens their sections;
  CRT and CSP open Device implant + CRT / CSP; Generator change sets Device action. Pacemaker / ICD / CRT narrow the
  case device types. Unticking asks first when a section has answers. The Primary procedure type is no longer
  picked: it follows the ticks (ablation first, then device work, LAA, ILR, EPS).
- **Filled by the app** (`shared/derive.ts`; the server stores them after every save, the browser shows them at once,
  offline too): procedure date from the episode date when empty; procedure type; Hajj timing (season
  1 Dhu al-Qa'dah → 15 Muharram; Before / During 8–13 Dhu al-Hijjah / After; Umrah-related; outside the season;
  not filled for non-pilgrims; `case_layout.json` form.hajj_season); primary EP diagnosis and subtype from the first
  procedure that says one (only into empty answers — a person's choice stays); eGFR (CKD-EPI 2021, from
  creatinine µmol/L, age at the lab date and sex; read only while creatinine is there); CSP target from the strategy;
  implant date precision; the hidden links (episode, the only procedure, baseline snapshot, latest baseline echo,
  case device).
- **Studies:** "For procedure" only when the case has two or more procedures (the only one is linked by itself).
  Labs have no procedure field in the dictionary (only the episode), so they cannot be tied to one procedure.
  Tilt-table test and each imaging type (CMR, Cardiac CT, TEE) start with **Done / Not done**; Done adds the study
  (with its type) and opens it, Not done asks and removes it. Holter **duration** = number + hours / days / months
  (stored in hours).
- **Device interrogation:** the Devices row is renamed and shown only when Baseline risk profile says Existing CIED =
  Yes, a procedure of the case is device work, or device rows exist. Device checks and their lead numbers were
  already inside the device (nested rows).
- **Patient:** height, weight and BMI (calculated, not stored) in the Patient sheet with sex and date of birth;
  removed from Baseline risk profile.

**Phase 3 — new items (local amendments, like M-3; never in the dictionary files).** Owner choices 24 Oct:
- Nationality: Saudi Arabia first, then ~25 common pilgrim / resident nationalities, then Other; type-ahead.
  List (owner approved 24 Oct): Saudi Arabia, Indonesia, Pakistan, India, Bangladesh, Egypt, Nigeria, Türkiye,
  Iran, Algeria, Sudan, Malaysia, Iraq, Morocco, Yemen, Afghanistan, Jordan, Syria, Philippines, Ethiopia, Nepal,
  Senegal, Niger, Mali, Uzbekistan, Somalia, Other.
- Residence: a **new amendment field** (Saudi citizen / Resident / International visitor) replaces the dictionary
  one on the form (like M-4b); the old one is hidden and keeps its column.
- "NSVT or VT detected" shown as **NSVT / VT detected** (label only; the field covers both).
- Valve lesion (echo) and scar location (CMR): **new multi-choice amendment fields**, same codes; the single-choice
  ones are hidden.

Items:
- PAC burden (after PVC burden); "Inpatient monitor" monitor type.
- Residence status choices: Saudi citizen / Resident / International visitor.
- Nationality as a type-ahead list of the commonest nationalities (pilgrims first).
- Multi-choice: significant valve lesion (echo), scar location (CMR).
- NSVT: "Non-sustained VT detected" Yes / No wording (owner note).
