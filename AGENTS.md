# Agent Workflow Commands

## Typography (103e9)

Defined in `styles.css` `:root` tokens and utility classes:

| Level | Utility | Typical use |
|-------|---------|-------------|
| H1 | `.text-h1` | Home title (`103e9`) |
| H2 | `.text-h2` / `.header-title` | Tool screen headers |
| H3 | `.text-h3` | Modal titles, large icons |
| H4 | `.text-h4` / `.item-title` | List row titles, card names |
| Body-large | `.text-body-lg` | Inputs, emphasis |
| Body | `.text-body` | Default UI copy |
| Body-small | `.text-body-sm` | Meta, subtitles, hints |
| Overline | `.text-overline` / `.section-label` | Section eyebrows (uppercase) |

Prefer semantic classes already in the app; use utilities for new markup. Adjust the scale via `--font-size-*` variables only.


When the user says exactly `make logged changes`, run this workflow:

1. Export open issues from the synced vault:
   - Command: `npm run issues:export-open`
   - Passphrase source (first match wins): `SYNC_PASSPHRASE` env var, or `SYNC_PASSPHRASE=...` in repo-root `.env.local` (gitignored; see `.env.example`).
2. Read `.cursor/open-issues.json` (if empty but the user expects work items, remind them to open the app once online so issues sync to the cloud, or use Issues → **Save for Cursor** and save the file as `.cursor/open-issues.json`).
3. Implement open issues sequentially in listed order.
4. After each issue:
   - make the code change,
   - run relevant checks/tests,
   - report what changed.
5. If blocked on any issue:
   - stop immediately,
   - report blocker and remaining issue IDs.
6. Do not mark issues complete automatically in app data. Completion remains manual in the app.

If `.cursor/open-issues.json` has zero open issues, report that there is nothing to implement and stop.

## Cursor Cloud specific instructions

This repo is a static, buildless vanilla-JS PWA. Firebase is loaded from the gstatic CDN in the browser (not bundled); the npm `firebase` dependency is only used by the Node export script `scripts/export-open-issues.mjs`.

- No build step, no linter, and no test framework are configured.
- Run the app in dev by serving the repo root as static files and opening `index.html`, e.g. `python3 -m http.server 5050 --bind 127.0.0.1` then visit `http://127.0.0.1:5050/index.html`. Do NOT open `index.html` via `file://` — ES module imports and Firebase require an HTTP origin.
- First screen asks for a "sync phrase"; connecting hashes it (SHA-256, lowercased+trimmed) into a Firestore vault id. Any phrase works and reaching Firestore needs outbound access to `www.gstatic.com` and Firestore. Use a throwaway phrase for testing so you don't touch real vault data.
- `npm run issues:export-open` (the `make logged changes` flow) requires the `SYNC_PASSPHRASE` secret (env var or `.env.local`); without it the script exits with a "Missing sync passphrase" error by design.
- Coach tool calls a Cloudflare Worker (`WORKER_URL` in `coach.js`) proxying Anthropic; it is optional and not needed for general dev.
