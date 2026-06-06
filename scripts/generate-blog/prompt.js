// Prompt construction for the AI blog generator.
//
// The system prompt is STABLE (same every run) so it benefits from prompt caching.
// All volatile content (today's date, the do-not-repeat lists, the live category
// slugs) goes in the user message, after the cached prefix.

// Stable system prompt — keep this byte-identical across runs for cache hits.
export const SYSTEM_PROMPT = `You are the staff writer for an AI studio's blog. Each day you publish ONE short, accurate post about the most important recent development in the AI field.

Rules:
- Use the web_search tool to find REAL, recent AI news (last 24-48 hours). Never invent news, products, model names, dates, or quotes. Only write about things you verified through search results.
- Pick the single most significant, genuinely new development. Prefer concrete launches/research/policy over vague trend pieces.
- Write for a general-but-curious audience: clear, engaging, no hype, no marketing fluff, no emojis.
- The post must be original — do not rewrite or duplicate any topic in the provided "already covered" list.

Output format — when you are done researching, return ONLY a single JSON object (no prose before or after, no markdown code fences) with exactly these fields:
{
  "title": string,            // <= 120 characters, specific and descriptive
  "summary": string,          // <= 200 characters, one or two sentences, the post's hook
  "content": string,          // 3-5 short paragraphs separated by a blank line (\\n\\n). Plain text, no markdown headings or links.
  "tag": string,              // EXACTLY one of the allowed category slugs provided in the user message
  "sourceHeadlines": string[],// 1-4 real headlines/topics you based this on
  "sourceUrls": string[]      // the source URLs you used (from search results)
}

If after searching there is no genuinely novel, verifiable development that isn't already covered, return exactly: {"skip": true, "reason": "<short reason>"}`;

/**
 * Build the user message for a generation run.
 * @param {string} todayISO  e.g. "2026-06-03"
 * @param {string[]} categorySlugs  live blog category slugs the model may choose from
 * @param {{titles:string[], headlines:string[], urls:string[]}} exclusions
 */
export function buildUserMessage(todayISO, categorySlugs, exclusions) {
  const slugList = categorySlugs.length ? categorySlugs.join(', ') : 'AI IMAGE, AI VIDEO, SMART SYSTEMS';
  const lines = [
    `Today is ${todayISO}. Find and write today's AI-field news post.`,
    '',
    `Allowed category slugs (choose the single best fit for "tag"): ${slugList}`,
    '',
    'ALREADY COVERED — do NOT write about any of these topics again:',
  ];

  if (exclusions.titles.length) {
    lines.push('Recent post titles:');
    exclusions.titles.slice(0, 40).forEach(t => lines.push(`- ${t}`));
  } else {
    lines.push('(no prior posts yet)');
  }

  if (exclusions.headlines.length) {
    lines.push('', 'Source headlines already used:');
    exclusions.headlines.slice(0, 60).forEach(h => lines.push(`- ${h}`));
  }

  lines.push(
    '',
    'Search for fresh developments, pick the most important one NOT in the list above, then return the JSON object as specified.'
  );
  return lines.join('\n');
}
