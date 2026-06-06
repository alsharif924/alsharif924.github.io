// Dedupe helpers for the AI blog generator.
//
// Goal: never publish a post that repeats a topic we've already covered.
// We give the model the list of recent titles/headlines to avoid (soft, prompt-level
// dedupe), and we also run a hard guard here (content hash + title similarity) as
// defense in depth in case the model returns something too close anyway.

import crypto from 'node:crypto';

/** Normalize a title for hashing/comparison: lowercase, strip punctuation, collapse spaces. */
export function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stable SHA-256 hash of the normalized title — stored in aiMeta.contentHash. */
export function contentHash(title) {
  return crypto.createHash('sha256').update(normalizeTitle(title)).digest('hex');
}

/** Tokenize a normalized string into a Set of words for Jaccard similarity. */
function tokenSet(title) {
  return new Set(normalizeTitle(title).split(' ').filter(Boolean));
}

/** Jaccard similarity (0..1) between two titles' word sets. */
export function titleSimilarity(a, b) {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  const union = sa.size + sb.size - inter;
  return inter / union;
}

/**
 * Decide whether a freshly generated post is a duplicate of anything we already have.
 * @param {{title:string, sourceUrls?:string[]}} candidate
 * @param {Array<{title?:string, aiMeta?:{contentHash?:string, sourceUrls?:string[]}}>} existing
 * @param {number} similarityThreshold  Jaccard >= this counts as a dupe (default 0.6)
 * @returns {{ isDuplicate: boolean, reason?: string }}
 */
export function isDuplicate(candidate, existing, similarityThreshold = 0.6) {
  const candHash = contentHash(candidate.title);
  const candUrls = new Set((candidate.sourceUrls || []).map(u => u.trim()).filter(Boolean));

  for (const post of existing) {
    // Exact normalized-title hash match.
    if (post.aiMeta?.contentHash && post.aiMeta.contentHash === candHash) {
      return { isDuplicate: true, reason: `identical title hash to "${post.title}"` };
    }
    // Fuzzy title overlap.
    const sim = titleSimilarity(candidate.title, post.title);
    if (sim >= similarityThreshold) {
      return { isDuplicate: true, reason: `title ${(sim * 100).toFixed(0)}% similar to "${post.title}"` };
    }
    // Shared source URL → same underlying news item.
    for (const u of post.aiMeta?.sourceUrls || []) {
      if (candUrls.has((u || '').trim())) {
        return { isDuplicate: true, reason: `shares source URL with "${post.title}"` };
      }
    }
  }
  return { isDuplicate: false };
}

/** Build the "do not repeat" lists handed to the model. */
export function buildExclusionContext(existing) {
  const titles = [];
  const headlines = new Set();
  const urls = new Set();
  for (const post of existing) {
    if (post.title) titles.push(post.title);
    for (const h of post.aiMeta?.sourceHeadlines || []) headlines.add(h);
    for (const u of post.aiMeta?.sourceUrls || []) urls.add(u);
  }
  return {
    titles,
    headlines: [...headlines],
    urls: [...urls],
  };
}
