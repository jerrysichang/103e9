# Personal Tools

A minimal personal tools app built with vanilla JS, hosted on GitHub Pages, with Firebase Firestore for cross-device sync.

## Tools

- **Gratitude** — track goals and reflect on what you've achieved
- **Coach** — personal life coach that knows your profile and learns over time
- **Fuel** — log meals and track macros against daily goals
- **Issues** — track changes/fixes for 103e3 and mark them complete

---

## Coach setup

### 1. Deploy the Cloudflare Worker (one-time, ~5 min)

1. Go to [workers.cloudflare.com](https://workers.cloudflare.com) and create a free account
2. Create a new Worker
3. Paste the contents of `cloudflare-worker.js` into the editor
4. Go to **Settings → Variables** and add a secret: `ANTHROPIC_API_KEY` = your Anthropic API key
5. Deploy and copy the worker URL (e.g. `https://my-coach.yourname.workers.dev`)

### 2. Set the Worker URL in coach.js

Open `coach.js` and update the constant at the top:

```js
const WORKER_URL = 'https://my-coach.yourname.workers.dev'
```

### 3. Seed your profile

Open the app, go to Coach, and say:

> "Set up my profile from scratch — ask me one question at a time."

The coach will ask you questions. When you end the session, it automatically extracts what it learned and writes it to your profile. Every future conversation starts with your full profile loaded in context.

---

## Issues workflow with Cursor (sequential)

The Issues tool is cloud-synced in the same vault as your other data. To let Cursor read open issues automatically, export them to `.cursor/open-issues.json`.

### 1. One-time: so Cursor can export without your typing each time

Copy `.env.example` to `.env.local` in the repo root and set:

```bash
SYNC_PASSPHRASE=your-sync-phrase
```

`.env.local` is gitignored. Alternatively you can keep using `export SYNC_PASSPHRASE=...` in the shell.

### 2. Export open issues (optional if you only use Cursor)

```bash
npm run issues:export-open
```

This writes `.cursor/open-issues.json` with only open issues.

### 3. Run a sequential implementation prompt in Cursor

In Cursor, use the phrase:

```text
make logged changes
```

Repo agent instructions in `AGENTS.md` map this phrase to the full sequential workflow.

Manual prompt version (if needed):

```text
Read `.cursor/open-issues.json`.
Implement the open issues one-by-one in listed order.
After each issue:
1) make the code change,
2) run relevant checks/tests,
3) report what changed.
If an issue is blocked, stop and explain the blocker before moving on.
Do not mark issues complete automatically in the app; completion is manual for now.
```

### 4. Mark completion manually in the app

After Cursor finishes, open the Issues screen and check off completed items.

### Troubleshooting: app shows open issues but export says 0

- **Passphrase mismatch:** `.env.local` must use the **same** sync phrase as the app (spacing/case differences are normalized, but typos are not).
- **Cloud never had issues yet:** Open the app once while online so it can connect; on connect, local-only issues are merged up to Firestore when the vault had none. Then run `npm run issues:export-open` again.
- **Immediate workaround:** In the app Issues screen, tap **Save for Cursor**, save the downloaded `open-issues.json` as `.cursor/open-issues.json` in this repo (replace the file). Then say `make logged changes` in Cursor.
