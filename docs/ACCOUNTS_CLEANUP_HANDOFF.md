# Hand-off: clean the owner's test accounts before phase 4

For a Claude session on the owner's own computer (Claude Desktop app with its built-in browser, or Claude in Chrome).
The cloud session that built phases 1–3 has no browser, so it could not do this step.

## Owner's words (22 Oct 2026)
- Accounts to use for the new registry (decision D9):
  - Google Apps Script: https://script.google.com/home (opened from the Trash page: https://script.google.com/home/trash)
  - Cloudflare Workers & Pages: https://dash.cloudflare.com/cfcaa4bff2f03acf68325881dcfd76f4/workers-and-pages
- "Delete anything registered in them." Asked to confirm what is in them, the owner said: **test items only** (nothing live, no real data).

## Rules (from the owner; do not relax)
- Replies to the owner in Egyptian Arabic; code and technical terms in English.
- Never copy secrets: no API tokens, keys, passwords or environment-variable values into chat, files or commits.
- Ask the owner before anything that could change or lose real data. Deleting cannot be undone.
- Stop after each step and wait for the owner.

## Steps
1. **Read only first.** Sign-in is done by the owner. List everything, without changing anything:
   - Apps Script: every project under My projects, Shared with me and Trash. For each one give its name, last modified date, and any linked Google Sheet (name only).
   - Cloudflare: every Worker and Pages project. For each one give its name, last deployment date, any custom domain or route, and any bound KV/D1/R2 (names only, never values).
2. **Flag anything that looks live:** a recent deployment, a custom domain, a linked Sheet with many rows, or a name containing "EP Workspace" or "registry". Show the list to the owner and ask which items to delete. If anything belongs to the live EP Workspace, it must not be deleted (decision D5: the live registry is never modified).
3. **Delete only the items the owner confirms by name.** Apps Script: move to Trash, then empty Trash only if the owner says so. Cloudflare: delete the Worker or Pages project. Do not touch Google Drive files or Sheets that are not on the confirmed list.
4. Report what was deleted, and stop. Phase 4 (new Google Sheet + Apps Script + Cloudflare deployment) starts only after the owner approves; see `docs/MERGE_PLAN.md`.
