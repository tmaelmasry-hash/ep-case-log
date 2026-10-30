# AVNRT questions in the SVT ablation section — proposal (30 Oct 2026)

**Status: owner approved 30 Oct 2026 (rules OWNER_APPROVED), merged into main. Not deployed yet.**

## The problem
The SVT ablation section (`SVT_ABLATIONS`) opens for three components: AVNRT, AVRT_WPW and AT_SVT. Until now no rule in
`config/rules.json` targeted its fields, so a procedure with **AVNRT only** also showed the accessory-pathway and the
atrial-tachycardia questions.

## Every SVT_ABLATIONS field for an AVNRT-only procedure (before this change)
Hidden by the field review (not shown anyway): `endpoint_confirmation`. Not a question: `procedure_id` (link, filled by
the app) and `other_specify_json` (the "Other — specify" box, appears only after "Other").

| Field | Label | Dictionary | Group | Proposed rule |
|---|---|---|---|---|
| `svt_mechanism` | SVT mechanism | RC, core ★ | **(a) fits AVNRT** | none (stays) |
| `ablation_target` | Ablation target | R, core ★ | **(a) fits AVNRT** | none (stays) |
| `ablation_energy` | Ablation energy | R, core ★ | **(a) fits AVNRT** | none (stays) |
| `acute_svt_endpoint` | Acute SVT endpoint | R, core ★ | **(a) fits AVNRT** | none (stays) |
| `accessory_pathway_manifestation` | Accessory pathway manifestation | C "for AVRT/WPW" | **(b) accessory pathway** | DR-SVT-01 |
| `accessory_pathway_location` | Accessory pathway location | C "for AVRT/WPW", core ★ only when the mechanism is AVRT / pre-excited AF | **(b) accessory pathway** | DR-SVT-02 |
| `ap_conduction_direction_assessed` | AP conduction direction assessed | C "for AVRT/WPW" | **(b) accessory pathway** | DR-SVT-03 |
| `at_chamber` | AT chamber | C "for AT" | **(c) AT** | DR-SVT-04 |
| `at_site_or_circuit` | AT site or circuit | C "for AT" | **(c) AT** | DR-SVT-05 |

(d) unsure: no field. The open points are about **codes** inside the fields that stay (see "Not built" below).

## The rules (all `show_when`, target `SVT_ABLATIONS.<field>`)
The trigger is the ticked component **or** the mechanism found at the study, so a procedure ticked as AVNRT whose
study shows an AVRT or AT still gets the right questions. Only dictionary fields and codes are used
(`PROCEDURE_COMPONENTS.component_type`, `SVT_ABLATIONS.svt_mechanism`); the AVRT codes are the same three the
dictionary's core list uses for `accessory_pathway_location`.

| Rule | Target | `when` |
|---|---|---|
| DR-SVT-01 | `accessory_pathway_manifestation` | `{"any": [{"component": ["AVRT_WPW"]}, {"field": "SVT_ABLATIONS.svt_mechanism", "in": ["ORTHODROMIC_AVRT", "ANTIDROMIC_AVRT", "PREEXCITED_AF"]}]}` |
| DR-SVT-02 | `accessory_pathway_location` | same as DR-SVT-01 |
| DR-SVT-03 | `ap_conduction_direction_assessed` | same as DR-SVT-01 |
| DR-SVT-04 | `at_chamber` | `{"any": [{"component": ["AT_SVT"]}, {"field": "SVT_ABLATIONS.svt_mechanism", "in": ["FOCAL_AT", "MACROREENTRANT_AT"]}]}` |
| DR-SVT-05 | `at_site_or_circuit` | same as DR-SVT-04 |

What the person sees:

| Procedure | Shown in SVT ablation |
|---|---|
| AVNRT only (mechanism empty, Typical, Atypical or Other) | mechanism, target, energy, endpoint |
| AVNRT + Accessory pathway (AVRT_WPW) | the four + the 3 pathway questions |
| AVNRT + AT / other SVT (AT_SVT) | the four + the 2 AT questions |
| AVNRT only, mechanism Orthodromic / Antidromic AVRT or Pre-excited AF | the four + the 3 pathway questions |
| AVNRT only, mechanism Focal AT or Macroreentrant AT | the four + the 2 AT questions |
| Accessory pathway only / AT only | unchanged from today except the other group's questions go |

Note: AT_SVT alone (also used for "other SVT") now hides the pathway questions, and AVRT_WPW alone hides the AT
questions. This follows the dictionary ("C for AVRT/WPW", "C for AT").

## How it behaves
- Same evaluator on the screen and on the server: an answer to a hidden question is refused on save.
- Ready to complete: unchanged for AVNRT alone — the dictionary's core list already asks for pathway location only
  when the mechanism is AVRT / pre-excited AF. The other four hidden fields were never core items.
- Changing the mechanism (for example AVRT → Typical AVNRT) while a pathway answer exists asks first to remove that
  answer (the existing "answers that would no longer apply" dialog).
- Answers already saved stay in the Sheet. If an older AVNRT-only procedure has a pathway or AT answer (for example
  "Not applicable"), it is no longer shown; nothing is deleted. Unticking "Accessory pathway" or "AT" also leaves its
  saved answers in the Sheet, hidden (same as every other component rule today).
- `"status": "PROPOSED"`: the rule engine (`shared/rules.ts`) does not read `status` (it is a label, like
  `OWNER_APPROVED` / `SOURCE_EXPLICIT`), so it did not break anything — but it also means the rules **are active on
  this branch**. The gate is the merge: on the owner's yes, change the five statuses to `OWNER_APPROVED` and merge.

## Not built (ask the owner if wanted)
- **Codes** inside the questions that stay still list every SVT: SVT mechanism (AVRT, pre-excited AF, AT codes),
  Ablation target (Accessory pathway, AT focus, AT isthmus), Acute SVT endpoint (Accessory pathway conduction
  abolished, AT terminated noninducible). They could be limited with `offer_when` rules, but this would refuse a
  mechanism found at the study that differs from what was ticked. Kept as is.
- `DIAGNOSTIC_EPS.accessory_pathway_location` (EP study section) is another section; not changed.

## Tests
`tests/server/avnrtQuestions.test.ts`: which fields show for AVNRT alone, AVNRT + WPW, AVNRT + AT, and by mechanism;
the server refuses pathway / AT answers for AVNRT alone and saves them for AVNRT + WPW; changing the mechanism asks to
remove pathway answers; Ready to complete does not ask pathway location for AVNRT alone and does for AVNRT + WPW with
AVRT.

## ملخص للدكتور طارق
المشكلة: في الـ procedure اللي فيها **AVNRT** بس، قسم **SVT ablation** كان بيعرض أسئلة الـ **accessory pathway**
(manifestation, location, conduction direction) وأسئلة الـ **AT** (AT chamber, AT site or circuit)، ودي مالهاش
علاقة بالـ AVNRT.

الاقتراح (5 rules جديدة، DR-SVT-01 لـ 05):
- أسئلة الـ **accessory pathway** تظهر بس لو اتعلّم على **Accessory pathway (AVRT_WPW)**، أو لو الـ **SVT mechanism**
  طلع Orthodromic AVRT أو Antidromic AVRT أو Pre-excited AF.
- أسئلة الـ **AT** تظهر بس لو اتعلّم على **AT / other SVT (AT_SVT)**، أو لو الـ mechanism طلع Focal AT أو
  Macroreentrant AT.
- يعني AVNRT لوحده = 4 أسئلة بس: mechanism, ablation target, ablation energy, acute SVT endpoint.
- AVNRT + WPW في نفس الـ procedure = أسئلة الـ pathway فاضلة زي ما هي.
- الإجابات القديمة المتسجلة **مش بتتمسح**، بتفضل في الـ Sheet بس مش بتظهر.
- الـ **Ready to complete** مش هيتغير للـ AVNRT (الـ pathway location أصلاً مش مطلوب غير لو الـ mechanism AVRT).

مش متعمل (لو حضرتك عايز): نشيل الـ codes اللي مش AVNRT من جوه الـ mechanism / ablation target / endpoint. سبناها
عشان لو الـ study طلّعت mechanism تاني غير اللي اتعلّم عليه، الدكتور يقدر يسجله.

الحالة: جاهز على branch، **مستني موافقة حضرتك**، ومش منشور.
