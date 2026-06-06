# AI Blog Trigger — Cloudflare Worker

Makes the dashboard's **Generate now** / **Regenerate** buttons fire the GitHub
Actions generator **instantly** (instead of waiting on the 5-minute cron).

## What it does
1. The dashboard POSTs the signed-in admin's Firebase **ID token** to this Worker.
2. The Worker verifies the token (signature, audience = your Firebase project, expiry,
   and that the email is one of your admins).
3. On success it calls GitHub's `repository_dispatch` API to start the workflow.

The AI key and Firebase service account never touch the Worker or the browser. The
Worker only holds a GitHub token scoped to triggering this one repo's Actions.

## One-time setup

### 1. Create a GitHub fine-grained token
GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token.
- **Resource owner:** your account (`alsharif924`)
- **Repository access:** Only select repositories → `alsharif924.github.io`
- **Permissions:** Repository permissions → **Actions: Read and write**
- Generate and copy the token (starts with `github_pat_...`).

### 2. Deploy the Worker
Requires a free Cloudflare account. From this `worker/` folder:

```bash
cd worker
npx wrangler login            # opens browser, sign in to Cloudflare (free)
npx wrangler secret put GITHUB_DISPATCH_TOKEN   # paste the github_pat_... token
npx wrangler deploy
```

`wrangler deploy` prints the Worker URL, e.g.:
`https://ai-blog-trigger.<your-subdomain>.workers.dev`

### 3. Point the dashboard at the Worker
Edit [`pages/manager/dashboard/dashboard.js`](../pages/manager/dashboard/dashboard.js)
— set `TRIGGER_WORKER_URL` to the URL from step 2, commit, and push.

> The non-secret config (Firebase project id, repo owner/name, admin emails, allowed
> origin) lives in [`wrangler.toml`](wrangler.toml). Update it there if any change.

## Test
- Dashboard → **Generate now**. Within a couple seconds the Worker returns 200 and a
  new run appears under repo → Actions → AI Blog Generator. The draft shows in the
  AI Blogs section ~1-2 min later (click **Refresh**).
- Sign out (or use a non-admin Google account) → the Worker returns **401/403** and
  no workflow runs. That proves only logged-in admins can trigger it.

## Fallback
If `TRIGGER_WORKER_URL` is left unset/placeholder, the dashboard falls back to writing
a `generationRequests` doc that the workflow's `*/5` cron drains (slower, cron-dependent).
