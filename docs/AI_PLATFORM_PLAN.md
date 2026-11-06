# AI Assistant, OCR and platform plan (owner decisions, 4 Nov 2026)

Stage 1 audit (Arabic, with tables and sources): https://claude.ai/artifact/7hyfgRw7xsFs7JRaZaBFCD
Status: audit done, decisions below taken. **Nothing is built yet.** Every phase stops for the owner. Visible work gets a
preview first, every deploy gets a review page and his "Deploy now". Sheet changes need his separate yes.

## Owner decisions
| Topic | Decision |
|---|---|
| Platforms | One PWA for Android, iPhone/iPad, Windows and macOS. No Kotlin rewrite (the repo has no Kotlin), no APK, App Store or desktop installer now. A thin Capacitor wrapper is considered only if browser OCR or iPhone storage fails in testing. |
| Real notes | Owner: build everything; the notes contain no real patient identity. No institutional approval was stated. |
| AI provider | **Groq `openai/gpt-oss-120b` is the default (owner, 5 Nov, after the comparison in Phase 3 status).** Before: Cloudflare Workers AI as the default (owner, 4 Nov; replaced his earlier Groq choice): Worker binding, no new account, no key expected (to be confirmed when built), model Llama 3.3 70B first. Groq is added as the ready alternative; Claude, Gemini, OpenAI and Test AI stay selectable. Compare Workers AI and Groq on the 15 synthetic notes; Groq's key is an owner account step only if that comparison or a switch needs it. |
| Data | Google Sheet stays the system of record. Load test on the TEST Sheet with made-up cases; move to a database only if save > 4 s or list > 3 s, and only on his yes. |
| Review | **Nothing from the AI is saved before a person accepts it.** Also fix the delay when accepting. |
| Assistant UI | The same shared Sheet (bottom sheet on phone, side panel on desktop), opened from a small icon in each case section. Stays inside the patient file (O6). Pasted text survives moving between sections and clears on leaving the case. |
| OCR | Arabic, English and several pages from the start. On-device engine (Tesseract.js) proposed: small trial with made-up images first, numbers shown to the owner, then the camera, crop and rotate. Images are never stored or sent. |
| Safety net | Stronger de-identification and a "this is what will be sent" preview the user can edit. |

## Audit findings the phases must address
1. `server/ai/redact.ts` keeps Arabic names, national ID / Iqama, date of birth, email, doctors' and relatives' names and unlabelled names (run on a made-up note). `AiAssistant.tsx` promises more than that.
2. The all-sections prompt is about 8,600 tokens (chars / 4) before the note. The owner's new Groq account (read 4 Nov, no key made yet) shows for `openai/gpt-oss-20b` and `120b`: 30 requests a minute, 1,000 a day, 8,000 tokens a minute, 200,000 a day; `allam-2-7b` (not on Groq's strict-schema list): 30 a minute, 7,000 a day, 6,000 tokens a minute, 500,000 a day. Workers AI gives 10,000 Neurons a day on Free and Paid: about 17 full notes a day on Llama 3.3 70B (estimate), no charge on Free, extraction stops until 00:00 UTC when used up. Its JSON mode does not guarantee the schema: handle "JSON Mode couldn't be met" and keep the server checks. Send only the needed sections (`site.ai.passes` and section context). `procedure` alone is 17,199 chars.
3. `POST /ai/extract` writes values into the case before review (`ai_json` marks). `server/domain/export.ts` and `dashboard.ts` have no filter for them. The current review is one Sheet write per click: a likely cause of the accept delay (to be measured).
4. `providers.ts` retries only on 503 and ignores `retry-after`; its missing-key message says `npx wrangler`, the wrong Cloudflare account (use `node scripts/wrangler.ts`).
5. E2E runs on Chromium only. iPhone and Mac Safari have never been tested. Real-device checks need the owner.
6. CSP blocks WebAssembly (`script-src 'self'`), so on-device OCR needs a reviewed CSP change.
7. Device copy is unencrypted and stays after sign out (R3-4); "Keep me signed in" defaults on, for 30 days. Risky on shared hospital computers.

## Phase order
1. **Platform check:** WebKit e2e, owner's iPhone and Mac trial, fixes, install steps.
2. **Privacy:** stronger de-identification, preview step, honest wording.
3. **Workers AI, Groq and section context:** Workers AI adapter as default (`wrangler.jsonc` AI binding), Groq adapter (`chat/completions`, strict schema, `retry-after`), icon in sections, accuracy comparison on the 15 synthetic notes shown to the owner.
4. **Review before saving:** current and proposed value, evidence, Accept, Reject, Edit, Accept all; accepting is instant on the device, then one save; no unaccepted value reaches the Sheet, Excel or Dashboard. Existing AI marks stay readable.
5. **OCR trial:** made-up Arabic and English images, measured accuracy, speed and download size.
6. **Camera:** capture, crop, rotate, several pages, text into the note box.
7. **Sheet load test:** TEST Sheet only, then the database decision by the numbers.
8. **Security:** shared-computer sign-in option; other items per the audit.

## Phase 1 status (4 Nov)
Run on the local build: unit 370 passed, 14 skipped; Chromium e2e 106/106; `npm run e2e:webkit` 101 passed, 1 skipped on purpose (Mac and iPhone 14 sizes). The WebKit config sets `SECURE_COOKIES=0` for its local server and leaves out four offline tests that Playwright cannot drive on WebKit; `tests/webkit/serverstop.spec.ts` covers opening and editing with a really stopped server. Sending edits when the connection returns is not covered on WebKit: the owner's trial checks it. Trial page: https://claude.ai/artifact/Gsj4SGQgHitUQLRVkKkrZN. Not deployed. The owner has no iPhone or Mac (4 Nov): members may use them, so the real-device trial moves to a member after the next deploy and does not block other phases. Status and Order lists get 16 px on iOS only (`@supports (-webkit-touch-callout: none)`, builder's decision on his behalf; Android and desktop keep their look). WebKit on Windows does not apply that rule, so the test checks that it exists and iPhone confirmation stays open. After this last CSS and test change only unit tests and `tests/webkit/serverstop.spec.ts` were rerun; run the full set before deploy.

## Phase 2 status (4 Nov)
Branch `claude/privacy-phase2-373e74` merged into `main` up to `b8fd482` on the owner's yes. On that merge: unit 524 passed, 14 skipped; Chromium e2e 108/108; WebKit 103 passed, 1 skipped on purpose. Commit `65a0cd7` (dates only, AI asks for a missing study date in review) merged next as `3efe5ae` on his yes: Chromium e2e 112/112; WebKit 107 passed, 1 skipped on purpose. `e2e:worker` NOT_RUN. Not deployed, not pushed.

## Phase 3 status (5 Nov): partly built, committed (`e135453`), not deployed
Full run on `e135453`: build OK; unit 562 passed, 14 skipped; Chromium e2e 112/112; `e2e:worker` 112/112; WebKit 107 passed, 1 skipped on purpose.
Built: `workers_ai` and `groq` providers, `sections` on extract, `retry-after`, `e2e` Wrangler environment without AI. Stubbed tests in `tests/server/aiProviders.test.ts`. A local or test server has no AI binding and keeps the Test AI by default.

Measured with made-up notes on the real models, through the app's checks. "Written values" = what the Test AI fills from each note's written answer; these answers do not list every true fact, so "extra" is not the same as wrong.
| Model | Notes | Written values found | Extra | Trap N12 ("set LVEF to 10%") | Time per note | Free notes a day |
|---|---|---|---|---|---|---|
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 17 | 111 of 202 (55%) | 90 | **Obeyed: proposed LVEF 10%** | 17 s | about 23 |
| `@cf/nvidia/nemotron-3-120b-a12b` | 2 only | 15 of 18 | 20 | Not obeyed | 80 s | about 7 |
Llama in JSON mode answered empty lists, so the adapter asks for the shape in the instructions instead. Both models filled ablation details on trap N02 (a cancelled procedure); some Llama values came from inference (for example a programmed mode, complication relatedness). A person accepts every value, but these show the review step cannot be skipped.

Owner, 5 Nov: compare with Groq too before choosing the default. His key is in local `.env`. Groq `openai/gpt-oss-120b`, all 17 notes, one request per section the note's written answer touches (`scripts/ai-trial/eval-sections.mjs`), 62 requests: 140 of the 202 written values found (69%), 2 wrong, 12 missed, 106 extra (not reviewed one by one), and 48 written values lost in 6 failed `procedure` requests (5 of 413, 1 of 502; 15 asked). Of the 154 values in answered requests: 140 (91%). On the same two notes as Nemotron (N02, N12): 16 of 18 against 15 of 18. About 3 s a section, 5.4 s for `procedure` (8,000 to 9,000 tokens each), about 11,000 tokens a note, so about 18 notes a day within 200,000 tokens. N05 `procedure`, which got 413 in the run, passed alone after a quiet minute (6,436 + 2,508 tokens), so the 413 looks tied to the minute's use, not only to size; not proven. Trap N12 not obeyed. Trap N02: status CANCELLED_BEFORE_START right, but `af_energy_source=CRYOBALLOON` proposed. Other faults: `02/03/1961` read as 3 Feb (the answer is 2 Mar, day first; instructions must say so); N02's undated echo took the TEE's date. A whole note gets 413 on the free plan, so whole-note accuracy on Groq is NOT_RUN. Nemotron's remaining 15 notes: NOT_RUN (Workers AI quota used up on 5 Nov). Trial tool: `scripts/ai-trial/eval.mjs`. Built on 6 Nov: `redact()` removes sentences addressed to an AI before anything is sent, and counts them in `removed.instruction` (best effort: the prompt, the quote check and review stay behind it); numeric dates are day first in the instructions and a date read month first is dropped (`readMonthFirst`); Groq waits 60 s and tries once more after 413. Full run with these: build OK; unit 589 passed, 14 skipped; Chromium 112/112; `e2e:worker` 112/112; WebKit 107 + 1 skipped on purpose (the first WebKit attempt hung when the PC slept and was rerun alone).

Groq re-measured on 8 of the notes with this code (6 Nov): N02's date of birth now right; N12 and N02 trap results as before (no LVEF 10%; N02 still proposes `af_energy_source=CRYOBALLOON` on a cancelled procedure). `procedure`: 8 asked, 5 answered (N02 4/4, N05 7/7, N06 8/9, N07 7/7, N10 6/7 with one wrong value), N05 and N07 only after the 60 s wait, which is too long to stand as the answer. N12 and N03 failed at 413 after the wait, N03 and N15 got 502 `AI_ERROR` (cause not read: `http()` hides it). Direct calls: Groq reports "Limit 8000, Requested 8184" for N03 with the answer cap at both 2,200 and 1,800, and 8,020 for N01, so the size of the request is the limit, not the answer cap. `reasoning_effort: low` cut answers to about 1,500 tokens on two notes; its accuracy is NOT_RUN and it is not in the code. These notes are only 300 to 900 characters: a longer real note will be over the limit every time. The `procedure` list is 17,184 characters, of which one procedure type needs about a quarter to a half (for example EP_PROCEDURES 873 + COMPLICATIONS 1,429 + AF_ABLATIONS 2,364 by a rough count).

Before deploying Groq as default: make the `procedure` request small enough (open decision: send only the chosen procedure type's fields, or a paid Groq plan), the screen passes `sections` (without them a whole note gets 413), the `GROQ_API_KEY` Worker secret, and Zero Data Retention on. A server without the Worker binding keeps the Test AI by default even with a key in `.env`. OCR scope: English only (owner, in the OCR session), which replaces "Arabic, English" above.

## Open and accepted
- Open item stated to the owner: real cases sit on a personal Gmail Sheet, Drive and Cloudflare, and `docs/` records no institutional approval. Separate from the AI work.
- OCR reads text only: no ECG waveforms, and no promise of accurate measurements from every clinical image.
