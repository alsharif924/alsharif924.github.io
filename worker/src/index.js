// Cloudflare Worker: secure "Generate now" / "Regenerate" trigger.
//
// Flow:
//   dashboard --POST {action, docId?}, Authorization: Bearer <Firebase ID token>-->
//   Worker verifies the Firebase ID token (signature + audience + expiry + admin email)
//   --> fires the GitHub Actions workflow via repository_dispatch (instant).
//
// The Worker holds ONLY a GitHub token (GITHUB_DISPATCH_TOKEN secret). The AI key
// and Firebase service account never come near it or the browser.
//
// Secrets (set with `npx wrangler secret put <NAME>`):
//   GITHUB_DISPATCH_TOKEN   fine-grained PAT with Actions: read & write on this repo
//
// Vars (in wrangler.toml):
//   FIREBASE_PROJECT_ID, GITHUB_OWNER, GITHUB_REPO, ALLOWED_EMAILS, ALLOWED_ORIGIN

// Google's public signing keys for Firebase ID tokens, in JWK form (so we can
// verify with pure WebCrypto — no Node APIs, no compatibility flags).
const GOOGLE_JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

// Cache the imported CryptoKeys per isolate (Google rotates them ~daily).
let keyCache = { keys: null, expires: 0 };

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// ── Base64url helpers ────────────────────────────────────────────────────────
function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function b64urlToString(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}

// ── Fetch + import Google's public signing keys (JWK -> CryptoKey per kid) ───────
async function getGoogleKeys() {
  const now = Date.now();
  if (keyCache.keys && keyCache.expires > now) return keyCache.keys;
  const res = await fetch(GOOGLE_JWK_URL);
  const { keys } = await res.json();
  const imported = {};
  for (const jwk of keys) {
    imported[jwk.kid] = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
  }
  // Respect cache-control max-age so we refresh when Google rotates keys.
  const cc = res.headers.get('cache-control') || '';
  const m = cc.match(/max-age=(\d+)/);
  const ttl = m ? parseInt(m[1], 10) * 1000 : 3600 * 1000;
  keyCache = { keys: imported, expires: now + ttl };
  return imported;
}

// ── Verify a Firebase ID token (RS256, Google securetoken) ──────────────────────
async function verifyIdToken(token, projectId) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const header = JSON.parse(b64urlToString(parts[0]));
  const payload = JSON.parse(b64urlToString(parts[1]));

  // Claims checks first (cheap).
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error('Bad audience');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Bad issuer');
  if (payload.exp <= now) throw new Error('Token expired');
  if (!payload.email) throw new Error('No email in token');

  // Signature check (pure WebCrypto).
  const keys = await getGoogleKeys();
  const key = keys[header.kid];
  if (!key) throw new Error('Unknown signing key');

  const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const sig = b64urlToBytes(parts[2]);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
  if (!ok) throw new Error('Bad signature');

  return payload;
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }

    // 1. Verify the caller is a logged-in admin.
    const authz = request.headers.get('Authorization') || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!token) return json({ error: 'Missing token' }, 401, origin);

    let payload;
    try {
      payload = await verifyIdToken(token, env.FIREBASE_PROJECT_ID);
    } catch (err) {
      return json({ error: `Auth failed: ${err.message}` }, 401, origin);
    }

    const allowed = (env.ALLOWED_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
    if (!allowed.includes(String(payload.email).toLowerCase())) {
      return json({ error: 'Not an admin' }, 403, origin);
    }

    // 2. Parse the request.
    let body = {};
    try { body = await request.json(); } catch { /* empty body ok */ }
    const action = body.action === 'regenerate' ? 'regenerate' : 'generate';

    // 3. Fire the GitHub Actions workflow via repository_dispatch.
    const ghRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'ai-blog-trigger',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_type: 'generate-blog',
          client_payload: { action, docId: body.docId || null, by: payload.email },
        }),
      }
    );

    if (!ghRes.ok) {
      const text = await ghRes.text();
      return json({ error: `GitHub dispatch failed (${ghRes.status})`, detail: text.slice(0, 200) }, 502, origin);
    }

    return json({ ok: true, action }, 200, origin);
  },
};
