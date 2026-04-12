# Personal Tools

A minimal personal tools app built with vanilla JS, hosted on GitHub Pages, with Firebase Firestore for cross-device sync.

## Tools

- **Gratitude** — track goals and reflect on what you've achieved
- **Coach** — personal life coach that knows your profile and learns over time

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
