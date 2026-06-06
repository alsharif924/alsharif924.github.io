// AI blog generator — runs server-side in GitHub Actions.
//
// Flow:
//   1. Init Firebase Admin SDK (service account from CI secret). The Admin SDK
//      bypasses Firestore rules, so it can write `status: 'pending'` drafts that
//      the public can never read.
//   2. Read recent blogs -> build a "do not repeat" list.
//   3. Ask Claude (with the web_search tool) for ONE fresh AI-news post as JSON.
//   4. Dedupe guard, then write a pending draft to the `blogs` collection.
//
// Secrets (env, never in the browser):
//   AI_API_KEY                 - Anthropic API key
//   FIREBASE_SERVICE_ACCOUNT   - full service-account JSON (single secret)
//
// Run directly:  node generate.js     (used by the daily cron + manual dispatch)
// Or import generateAndStore() from poll.js for the manual-request queue.

import { readFileSync } from 'node:fs';
import admin from 'firebase-admin';
import Anthropic from '@anthropic-ai/sdk';
import { buildExclusionContext, isDuplicate, contentHash } from './dedupe.js';
import { SYSTEM_PROMPT, buildUserMessage } from './prompt.js';

const MODEL = 'claude-opus-4-8';
const RECENT_LIMIT = 40;            // how many recent posts to dedupe against
const MAX_PAUSE_CONTINUATIONS = 6;  // server-tool (web_search) loop continuations

// ── Firebase Admin ────────────────────────────────────────────────────────────
// Accepts the service account as EITHER inline JSON (FIREBASE_SERVICE_ACCOUNT,
// used by GitHub Actions) OR a path to the JSON file (FIREBASE_SERVICE_ACCOUNT_FILE
// or GOOGLE_APPLICATION_CREDENTIALS, convenient for local runs in any shell).
export function initFirestore() {
  if (!admin.apps.length) {
    const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
    const file = process.env.FIREBASE_SERVICE_ACCOUNT_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS;
    let serviceAccount;
    if (inline) {
      serviceAccount = JSON.parse(inline);
    } else if (file) {
      serviceAccount = JSON.parse(readFileSync(file, 'utf8'));
    } else {
      throw new Error('Set FIREBASE_SERVICE_ACCOUNT (inline JSON) or FIREBASE_SERVICE_ACCOUNT_FILE (path to the JSON file).');
    }
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin.firestore();
}

// ── Read existing data ──────────────────────────────────────────────────────────
async function fetchRecentBlogs(db) {
  const snap = await db.collection('blogs').orderBy('createdAt', 'desc').limit(RECENT_LIMIT).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fetchBlogCategorySlugs(db) {
  const snap = await db.collection('categories').where('type', '==', 'blogs').get();
  const slugs = snap.docs.map(d => d.data().slug).filter(Boolean);
  return slugs.length ? slugs : ['AI IMAGE', 'AI VIDEO', 'SMART SYSTEMS'];
}

// ── Call Claude with web search, return parsed JSON ─────────────────────────────
function extractText(message) {
  return message.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
}

function parseJsonFromText(text) {
  // The model is told to return only JSON, but strip accidental fences just in case.
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) t = fence[1].trim();
  // If there's leading/trailing prose, grab the outermost {...}.
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first === -1 || last === -1) throw new Error('No JSON object found in model output.');
  return JSON.parse(t.slice(first, last + 1));
}

async function generatePost(anthropic, todayISO, categorySlugs, exclusions) {
  const tools = [{ type: 'web_search_20260209', name: 'web_search' }];
  const system = [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];
  const userMessage = buildUserMessage(todayISO, categorySlugs, exclusions);

  let messages = [{ role: 'user', content: userMessage }];
  let response;

  for (let i = 0; i <= MAX_PAUSE_CONTINUATIONS; i++) {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system,
      tools,
      messages,
    });

    // Server-side web_search loop hit its cap — re-send to resume (no extra user msg).
    if (response.stop_reason === 'pause_turn') {
      messages = [
        { role: 'user', content: userMessage },
        { role: 'assistant', content: response.content },
      ];
      continue;
    }
    break;
  }

  if (response.stop_reason === 'refusal') {
    throw new Error('Model refused to generate the post.');
  }

  const text = extractText(response);
  return parseJsonFromText(text);
}

// ── Validation ──────────────────────────────────────────────────────────────────
function validatePost(post, categorySlugs) {
  const errs = [];
  if (!post.title || typeof post.title !== 'string') errs.push('missing title');
  else if (post.title.length > 120) post.title = post.title.slice(0, 120).trim();
  if (post.summary && post.summary.length > 200) post.summary = post.summary.slice(0, 200).trim();
  if (!post.content || typeof post.content !== 'string') errs.push('missing content');
  if (!post.tag || !categorySlugs.includes(post.tag)) post.tag = categorySlugs[0];
  if (!Array.isArray(post.sourceHeadlines)) post.sourceHeadlines = [];
  if (!Array.isArray(post.sourceUrls)) post.sourceUrls = [];
  if (errs.length) throw new Error(`Invalid post: ${errs.join(', ')}`);

  // Arabic fields: fall back to the English value if missing, so the doc is always
  // consistent. Apply the same length guards to the Arabic title/summary.
  post.title_ar = (typeof post.title_ar === 'string' && post.title_ar.trim())
    ? post.title_ar.trim().slice(0, 120) : post.title;
  post.summary_ar = (typeof post.summary_ar === 'string' && post.summary_ar.trim())
    ? post.summary_ar.trim().slice(0, 200) : (post.summary || '');
  post.content_ar = (typeof post.content_ar === 'string' && post.content_ar.trim())
    ? post.content_ar.trim() : post.content;

  return post;
}

// ── Main entry: generate one post and store it as a pending draft ───────────────
export async function generateAndStore(db) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error('AI_API_KEY env var is missing.');
  const anthropic = new Anthropic({ apiKey });

  const todayISO = new Date().toISOString().slice(0, 10);
  const [recent, categorySlugs] = await Promise.all([
    fetchRecentBlogs(db),
    fetchBlogCategorySlugs(db),
  ]);
  const exclusions = buildExclusionContext(recent);

  // Try once, then retry once with the duplicate explicitly excluded.
  let post;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await generatePost(anthropic, todayISO, categorySlugs, exclusions);

    if (raw && raw.skip) {
      console.log(`No novel news today — skipping. Reason: ${raw.reason || 'unspecified'}`);
      return { skipped: true, reason: raw.reason };
    }

    post = validatePost(raw, categorySlugs);
    const dup = isDuplicate(post, recent);
    if (!dup.isDuplicate) break;

    console.warn(`Attempt ${attempt + 1}: duplicate (${dup.reason}). Retrying with stronger exclusions.`);
    exclusions.titles.unshift(post.title); // make the retry avoid this too
    post = null;
  }

  if (!post) {
    console.log('Could not produce a non-duplicate post after retry — skipping today.');
    return { skipped: true, reason: 'duplicate after retry' };
  }

  const docRef = await db.collection('blogs').add({
    title: post.title.trim(),
    summary: (post.summary || '').trim(),
    content: post.content.trim(),
    title_ar: post.title_ar,
    summary_ar: post.summary_ar,
    content_ar: post.content_ar,
    tag: post.tag,
    orientation: 'landscape',
    coverUrl: '',
    coverMediaType: 'image',
    status: 'pending',
    aiGenerated: true,
    aiMeta: {
      model: MODEL,
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      sourceHeadlines: post.sourceHeadlines.slice(0, 6),
      sourceUrls: post.sourceUrls.slice(0, 6),
      contentHash: contentHash(post.title),
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`Created pending draft ${docRef.id}: "${post.title}"`);
  return { id: docRef.id, title: post.title };
}

// ── CLI entry ────────────────────────────────────────────────────────────────────
const isMain = import.meta.url === `file://${process.argv[1]}` ||
               process.argv[1]?.endsWith('generate.js');
if (isMain) {
  (async () => {
    const db = initFirestore();
    // Regenerate path: delete the rejected draft first, then generate a fresh one.
    const regenId = process.env.REGENERATE_DOC_ID;
    if (regenId) {
      await db.collection('blogs').doc(regenId).delete().catch(() => {});
      console.log(`Deleted draft ${regenId} before regenerating.`);
    }
    await generateAndStore(db);
  })()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Generation failed:', err);
      process.exit(1);
    });
}
