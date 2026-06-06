# AI Blog Generator — Setup & Operations

The site automatically writes one blog post per day about the latest AI-field news,
saves it as a hidden **pending** draft, and lets an admin **Approve / Reject / Regenerate**
it from the dashboard. This doc covers setup, security, and operations.

## Why there's a backend

The website is a static site on GitHub Pages — it can't run server code, schedule
jobs, or hold secrets. An AI API key placed in browser JavaScript can always be
extracted via DevTools. So generation runs in **GitHub Actions** (server-side), where
the AI key and Firebase service account live as encrypted secrets, never shipped to
the browser.

```
GitHub Actions (daily cron + manual)         Firestore `blogs`            Site
  scripts/generate-blog/generate.js  ──write──►  status:'pending'  ──read──►  Dashboard "AI Blogs"
   • Claude + web_search (real news)              (hidden from public)         Approve / Reject / Regenerate
   • dedupe vs recent posts                                                    Approve → status:'published'
   • Admin SDK (bypasses rules)                   status:'published' ──read──► Public home carousel
```

## One-time setup

### 1. Firebase service account
Firebase Console → Project Settings → **Service accounts** → *Generate new private key*.
Download the JSON. Keep it secret (it's covered by `.gitignore`).

### 2. Anthropic API key
Get an API key from the Anthropic console.

### 3. Add GitHub Actions secrets
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret name | Value |
|---|---|
| `AI_API_KEY` | your Anthropic API key |
| `FIREBASE_SERVICE_ACCOUNT` | the **entire** service-account JSON, pasted as one value |

### 4. Deploy Firestore security rules (important)
The rules lock the database: only the 3 admin emails can write; the public can read
only published (non-pending) posts. Without them, pending drafts would be publicly
readable. Run once locally:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,firestore:indexes --project website-61d2a
```

> The admin email list lives in **two** places and must stay in sync:
> [`shared/js/firebase-auth.js`](../shared/js/firebase-auth.js) (`ALLOWED`) and
> [`firestore.rules`](../firestore.rules) (`isAdmin()`).

### 5. Backfill `status` on existing posts (one-time)
The public home page queries `where('status','==','published')`. Posts created
before this feature have no `status` field and would disappear from the public
site until backfilled. Run once:

```bash
cd scripts/generate-blog
FIREBASE_SERVICE_ACCOUNT="$(cat path/to/serviceAccount.json)" node backfill-status.js
```

Safe to re-run — it only touches posts missing `status`.

### 6. Firestore composite indexes
`firestore.indexes.json` defines the two indexes the dashboard/poller queries need
(`blogs`: status + createdAt; `generationRequests`: processed + createdAt). The
`firebase deploy` above creates them. If you ever see an index error in the console,
it prints a one-click link to create the missing index.

## How it runs

- **Daily post:** the `0 6 * * *` cron in [`.github/workflows/ai-blog.yml`](../.github/workflows/ai-blog.yml)
  runs `generate.js`. Adjust the UTC time to your local morning.
- **Manual "Generate now" / "Regenerate":** the dashboard writes a doc to the
  admin-only `generationRequests` collection. The `*/5 * * * *` cron runs `poll.js`,
  which processes pending requests (typically within ~5 minutes).
- **Run on demand:** Actions tab → *AI Blog Generator* → *Run workflow*.

## Local testing (no secrets in the browser)

```bash
cd scripts/generate-blog
npm install
# Provide secrets via env (use a gitignored .env or export inline):
AI_API_KEY=sk-ant-... FIREBASE_SERVICE_ACCOUNT="$(cat path/to/serviceAccount.json)" node generate.js
```

A `status:'pending'` doc should appear in Firestore with a populated `aiMeta`. Run it
twice — the second run should skip or produce a clearly different topic (dedupe).

## Reviewing posts

Dashboard → **AI Blogs** section:
- **Approve** → sets `status:'published'` and refreshes `createdAt`, so it appears at the
  top of the public home carousel.
- **Reject** → deletes the draft.
- **Regenerate** → deletes this draft and queues a fresh generation (appears after ~5 min; use **Refresh**).
- **Generate now** → queues an on-demand generation.

## Data model additions (`blogs` documents)

| Field | Meaning |
|---|---|
| `status` | `'pending'` (AI draft, hidden) or `'published'` (public). All posts must have this — legacy ones are backfilled (setup step 5). |
| `aiGenerated` | `true` for AI posts (manual posts omit it). |
| `aiMeta` | `{ model, generatedAt, sourceHeadlines[], sourceUrls[], contentHash }` — display + dedupe. |

## Security checklist

- AI key + service account exist **only** in GitHub Actions secrets.
- Firestore rules deployed: public can't read pending drafts; only admins can write.
- `.gitignore` blocks `.env` and any service-account JSON.
- The browser only ever holds the signed-in admin's own short-lived Firebase ID token.
