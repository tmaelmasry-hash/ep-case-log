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
## Still to build (owner notes on the review page)
**Phase 2 — behaviour (preview first):**
- Procedure: one tick list of 17 items (AF, Flutter, AVNRT, Accessory pathway, AT / other SVT, AV node, PVC, VT,
  Pacemaker, ICD, CRT, CSP, Generator change / upgrade, Lead extraction / revision, ILR, EPS, LAA); each opens its
  section, several stack; primary procedure type set from the ticks (R3-1 extended).
- Auto-fill: baseline snapshot and study links; Hajj timing from the episode / procedure date and the Hajj season
  (owner 24 Oct: season **1 Dhu al-Qa'dah → 15 Muharram**, adjustable later; inside it **Before Hajj** until
  7 Dhu al-Hijjah, **During Hajj** 8–13 Dhu al-Hijjah, **After Hajj** to the season end; outside it "Outside
  pilgrimage season"; Umrah-related when the patient is Umrah) — hidden as a field; Primary EP diagnosis and subtype from the procedure; eGFR calculated from creatinine,
  age and sex; implant date precision; CSP target from the strategy.
- Episode start date and procedure date: one date.
- Labs, echo, Holter: "which procedure" chooser only when the case has more than one procedure.
- Tilt test and each imaging type (CMR / CT / TEE): first question Done / Not done; Done opens the fields.
- Device section renamed **Device interrogation**, shown when Patient history says previous device implant;
  Device checks merged into it; Check channels merged into the device check.
- Height, weight (BMI) with sex and date of birth in one basic patient section.
- Holter duration as number + unit (hours / days; months for a loop recorder).

**Phase 3 — new items (local amendments, like M-3; never in the dictionary files):**
- PAC burden (after PVC burden); "Inpatient monitor" monitor type.
- Residence status choices: Saudi citizen / Resident / International visitor.
- Nationality as a type-ahead list of the commonest nationalities (pilgrims first).
- Multi-choice: significant valve lesion (echo), scar location (CMR).
- NSVT: "Non-sustained VT detected" Yes / No wording (owner note).
