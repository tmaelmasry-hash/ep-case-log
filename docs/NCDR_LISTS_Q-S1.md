# Q-S1 — NCDR dynamic lists (31 Oct 2026)

Source: the public NCDR Coder's Data Dictionaries on cvquality.acc.org (no login), downloaded 31 Oct 2026 with the
owner's yes:
- AFib Ablation Registry Coder's Data Dictionary v2.0 (printed 1/9/2026; effective for discharges on/after 1 Oct 2024).
- EP Device Implant Registry Coder's Data Dictionary v3.0 (printed 1/9/2026; effective for discharges on/after 1 Jan 2025).

The PDF text layer is scrambled (Type3 font), so the values below were read from the page images (Windows OCR, then
checked by eye against the page). Codes are NCDR's; we keep our own codes and note the NCDR code for export.

The owner asked the builder to decide (31 Oct: "I don't know, do everything yourself").

## 1. Product lists (catheter, defibrillator / pacemaker, leads): not public → closed
#7255 Catheter Ablation Device, #7635 Implant Device ID, #7720 Lead ID are "controlled by a ... Device Master file"
that NCDR gives to participating sites and certified vendors. They are not in the dictionary. **Decision:** keep
manufacturer + model as text (as now). Nothing to build. UDI / serial stay as they are.

## 2. Symptoms Experienced #15723 (AF) — "Symptoms Prior to Ablation" 1.3.6.1.4.1.19376.1.4.1.6.5.948
| NCDR selection | NCDR code | Ours (`ARRHYTHMIA_INDICATIONS.presentation`) |
|---|---|---|
| Anxiety | 48694002 | **add `ANXIETY`** |
| Chest pain | 29857009 | CHEST_PAIN |
| Dyspnea at rest | 161941007 | DYSPNEA |
| Dyspnea on exertion | 60845006 | DYSPNEA |
| Fatigue | 84229001 | FATIGUE |
| Irregular heartbeat | 361137007 | **add `IRREGULAR_HEARTBEAT`** |
| Light-headedness | 386705008 | PRESYNCOPE |
| Palpitations | 80313002 | PALPITATIONS |
| Other | 112000003645 | (free text "Other" of the case) |

**Decision:** add the two missing codes to `presentation` (codes only, same Sheet cell, no new column). Dyspnea is not
split into rest / exertion (our field serves every arrhythmia; nothing is lost that NCDR AF needs beyond that split).

## 3. PVI Energy Source #15722 — "Ablation Energy Source" 1.3.6.1.4.1.19376.1.4.1.6.5.947 (select all)
Cryoenergy 112000003639 · Ethanol 112000003640 · Laser 112000003641 · Pulsed Field Ablation 112000003642 ·
Radiofrequency 112000003643 · Other 112000003644.

**Found while building:** this already exists since 22 Oct (M-3 A1): `AF_ABLATIONS.af_energy_sources_used`
("Energies used", several), shown only when the energy source is "Multiple". **Decision:** add the one missing
NCDR value, `ETHANOL` (code only, same Sheet cell, no new column). `af_energy_source` is unchanged; an Ethanol case
counts under "Multiple energies" in the menu.

## 4. Prior Catheter Ablation Strategy #4435 — "Ablation Strategy" 1.3.6.1.4.1.19376.1.4.1.6.5.211 (select all)
| NCDR selection | NCDR code |
|---|---|
| Complex Fractionated Atrial Electrogram | 100000910 |
| Convergent Procedure | 100000911 |
| Cryoablation | 233161001 |
| Empiric LA Linear Lesions | 100000912 |
| Focal Ablation | 100000913 |
| Ganglion Plexus Ablation | 100000914 |
| Pulmonary Vein Isolation | 100000915 |
| Pulsed Field Ablation | 112000003642 |
| Rotor Based Mapping | 100000917 |
| Segmental PV Ablation | 100000916 |
| Wide Area Circumferential Ablation | 100000918 |

(The note says the list is also controlled by an "Ablation Strategy Master file"; the 11 printed values are used.)
**Decision:** new field `AF_ABLATIONS.prior_af_ablation_strategies` (several, the 11 values above), shown for AF
ablation when there was a prior ablation (redo / prior count ≥ 1). One new AF_ABLATIONS column.

## 5. Echocardiogram Results #15707 — 1.3.6.1.4.1.19376.1.4.1.6.5.946 (select all)
Atrial thrombus detected · LV hypertrophy none / mild / moderate / severe · LA not enlarged / mild / moderate / severe ·
RA not enlarged / mild / moderate / severe.

| NCDR group | Ours |
|---|---|
| LA enlargement | `ECHO_STUDIES.la_size_category` (already) |
| Atrial thrombus | `AF_ABLATIONS.la_laa_thrombus_status` (already, TEE / CT) |
| LV hypertrophy | **new `ECHO_STUDIES.lv_hypertrophy`**: None / Mild / Moderate / Severe |
| RA enlargement | **new `ECHO_STUDIES.ra_size_category`**: Normal / Mild / Moderate / Severe / Unknown |

Two new ECHO_STUDIES columns.

## 6. Already exact (no change)
Final device type #15794 "Implantation Device Type - Dynamic" (EP Device v3.0 p.34): our device types already cover
the 14 values (crosswalk said EXACT).

## Build summary (31 Oct)
- Codes added: 3 — `presentation` ANXIETY, IRREGULAR_HEARTBEAT (NCDR-1); `af_energy_sources_used` ETHANOL (NCDR-2).
- New fields / Sheet columns: 3 — `AF_ABLATIONS.prior_af_ablation_strategies` (NCDR-3, rule DR-NCDR-3: redo only),
  `ECHO_STUDIES.lv_hypertrophy` (NCDR-4A, after RV function), `ECHO_STUDIES.ra_size_category` (NCDR-4B, after the
  LA volume index). All optional. The PFA strategy shows the app's shared label "PFA (pulsed field)".
- Sheet: `node scripts/sheets.ts setup --test`, then main, **only on the owner's separate yes**, before the deploy.
- All additions are in `config/local_amendments.json` and `config/rules.json`; the dictionary is not edited.
- No saved value is hidden or changed. Test: `tests/server/ncdrLists.test.ts`.
