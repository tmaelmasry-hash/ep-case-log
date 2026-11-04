# AI Assistant, OCR and platform plan (owner decisions, 4 Nov 2026)

Stage 1 audit (Arabic, with tables and sources): https://claude.ai/artifact/7hyfgRw7xsFs7JRaZaBFCD
Status: audit done, decisions below taken. **Nothing is built yet.** Every phase stops for the owner. Visible work gets a
preview first, every deploy gets a review page and his "Deploy now". Sheet changes need his separate yes.

## Owner decisions
| Topic | Decision |
|---|---|
| Platforms | One PWA for Android, iPhone/iPad, Windows and macOS. No Kotlin rewrite (the repo has no Kotlin), no APK, App Store or desktop installer now. A thin Capacitor wrapper is considered only if browser OCR or iPhone storage fails in testing. |
| Real notes | Owner: build everything; the notes contain no real patient identity. No institutional approval was stated. |
| AI provider | **Cloudflare Workers AI is the default** (owner, 4 Nov; replaces his earlier Groq choice): Worker binding, no new account, no key expected (to be confirmed when built), model Llama 3.3 70B first. Groq is added as the ready alternative; Claude, Gemini, OpenAI and Test AI stay selectable. Compare Workers AI and Groq on the 15 synthetic notes; Groq's key is an owner account step only if that comparison or a switch needs it. |
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
Branch `claude/privacy-phase2-373e74` merged into `main` up to `b8fd482` on the owner's yes. On that merge: unit 524 passed, 14 skipped; Chromium e2e 108/108; WebKit 103 passed, 1 skipped on purpose. `e2e:worker` NOT_RUN. Commit `65a0cd7` on that branch is not merged. Not deployed, not pushed.

## Open and accepted
- Open item stated to the owner: real cases sit on a personal Gmail Sheet, Drive and Cloudflare, and `docs/` records no institutional approval. Separate from the AI work.
- OCR reads text only: no ECG waveforms, and no promise of accurate measurements from every clinical image.
