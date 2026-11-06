# OCR trial 2: new made-up sheets, simulated phone photos (7 Nov 2026)

Measured on a PC in Chromium, with Tesseract.js 7.0.0, model `4.0.0_best_int`, English only. The app and the phone test page were not changed. All sheets are made up (MRNs 9990xxx). **No real camera, printer, phone or handwriting was used:** photos are simulated with blur, tilt, shadow, dim light, glare, noise and JPEG. Trial 1 and its tools: `docs/ocr-trial/` on branch `claude/ocr-trial-0e01bd`.

## What changed in the recipe
Old: `rectify, sharpen, flatten, unline`, page mode 6. New: the same steps, then enlarge the image 2 times, page mode 3.
- Page mode 3 read a two-column page in order (100% against 23%). In mode 6 the columns mix, so values can sit beside the wrong labels.
- Enlarging after the steps reduced wrong numbers. Enlarging before them made things worse.
- Other recipes tried on 4 sheets: leaving out `sharpen` or `flatten` did not help, and leaving out `unline` lost most tables. Model `4.0.0` gave identical results, so that comparison probably did not change the model: NOT_RUN in effect.

## Results on the 3 exam sheets
Written after the new recipe was chosen, and never used to choose anything. The photo conditions were set before the exam.

| Photos | Recipe | Numbers read right | Wrong | Wrong by a lost decimal point | Missing |
|---|---|---|---|---|---|
| Usable (clean, good, tilted, shadow, dim, glare; 18 images, 426 numbers) | old | 92.0% | 29 | 28 | 5 |
| Usable | **new** | **94.6%** | **13** | **13** | 10 |
| Bad (far, shake, worst; 9 images, 213 numbers) | old | 62.4% | 65 | 11 | 15 |
| Bad | **new** | 66.7% | 52 | 28 | 19 |

On the 6 earlier sheets, which were used to choose the recipe, so optimistic: usable photos 94.1% (46 wrong), against 82.4% with the old recipe, much of that gap being the two-column page.

Trial 1's 96.9% does not hold on new sheets: expect about 95% on usable photos, and about 2 in every 3 numbers on bad ones.

## The remaining danger
**A lost decimal point:** `1.4 -> 14`, `4.3 -> 43`, `0.6 -> 06`. Every wrong number on the usable exam photos was this kind.

Flagging words with OCR confidence under 90, or a whole number starting with 0, marked 13 of those 13 and 48 of the 52 on bad photos. It flags 27% of number words on usable photos, so a person checks about 1 number in 4. The match of a wrong number to its flag is by text, so it is close, not exact. On bad photos the 4 unflagged wrong numbers include an MRN digit misread, so a review of everything stays necessary.

Bad photos are not separated cleanly by the measures tested: a dim usable photo has lower sharpness (110) than a shaken one (208), and page confidence runs 74 to 87 on bad photos against 89 to 91 on usable ones. A retake warning needs its threshold set on real photos.

## Cost
Median 2.9 s a page on usable photos, against 1.7 s with the old recipe. WebKit for Windows: 3.6 to 5.5 s, on the exam sheets clean and good only. **Memory with the 2 times enlargement was not measured.** Trial 1 peaked at about 457 MB before it, and this was already the main risk on iPhone.

## Not measured
Real phones (speed, memory, iOS Safari), real photos of paper, real hospital printouts, handwriting. The live test page at https://ep-ocr-phone-trial.pages.dev/ still has the old recipe.

## Run it
`scripts/ai-trial` holds no OCR code. `scripts/ocr-trial/heldout.mjs` needs the `web/` folder from the branch above beside it and the packages from its README: `OCR_PKGS=<folder> OCR_OUT=<folder> OCR_RECIPE=new|old node heldout.mjs chromium`.
