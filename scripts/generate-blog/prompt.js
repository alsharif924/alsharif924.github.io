// Prompt construction for the AI blog generator.
//
// The system prompt is STABLE (same every run) so it benefits from prompt caching.
// All volatile content (today's date, the do-not-repeat lists, the live category
// slugs) goes in the user message, after the cached prefix.

// Stable system prompt — keep this byte-identical across runs for cache hits.
export const SYSTEM_PROMPT = `You are the staff writer for an AI studio's blog. Each day you publish ONE short, accurate post about a recently launched or updated AI tool — an app, product, model, or feature that people can actually use.

Rules:
- Use the web_search tool to find a REAL, recently launched or updated AI tool or feature (last few days to weeks). Never invent tools, products, model names, features, prices, dates, or quotes. Only write about things you verified through search results.
- Pick the single most noteworthy AI tool launch or update. Focus on usable tools (e.g. an AI image or video generator, a coding assistant, a writing/automation app, a new feature inside an existing tool). EXCLUDE non-tool news such as funding rounds, policy/regulation, executive or hiring moves, research papers with no usable tool, and opinion/trend pieces.
- Write for a general-but-curious audience: clear, engaging, no hype, no marketing fluff, no emojis. Explain what the tool does, who it's for, and what you can do with it.
- The post must be original — do not rewrite or duplicate any tool already in the provided "already covered" list.

Output format — when you are done researching, return ONLY a single JSON object (no prose before or after, no markdown code fences) with exactly these fields:
{
  "title": string,            // English. <= 120 characters, specific and descriptive
  "summary": string,          // English. <= 200 characters, one or two sentences, the post's hook
  "content": string,          // English. 3-5 short paragraphs separated by a blank line (\\n\\n). Plain text, no markdown headings or links.
  "title_ar": string,         // Arabic translation of "title". <= 120 characters.
  "summary_ar": string,       // Arabic translation of "summary". <= 200 characters.
  "content_ar": string,       // Arabic translation of "content". Keep the SAME paragraph breaks (\\n\\n).
  "tag": string,              // EXACTLY one of the allowed category slugs provided in the user message
  "sourceHeadlines": string[],// 1-4 real headlines/topics you based this on
  "sourceUrls": string[]      // the source URLs you used (from search results)
}

The "_ar" fields must be a natural, fluent Modern Standard Arabic translation that conveys the same meaning as the English version — NOT transliteration, and not machine-literal. Keep technical product/model names in their original form where that is how Arabic readers refer to them.

If after searching there is no genuinely new or updated AI tool worth covering that isn't already covered, return exactly: {"skip": true, "reason": "<short reason>"}`;

/**
 * Build the user message for a generation run.
 * @param {string} todayISO  e.g. "2026-06-03"
 * @param {string[]} categorySlugs  live blog category slugs the model may choose from
 * @param {{titles:string[], headlines:string[], urls:string[]}} exclusions
 * @param {string|null} preferredTag  the "AI News" slug to default to (if it exists)
 */
export function buildUserMessage(todayISO, categorySlugs, exclusions, preferredTag) {
  const slugList = categorySlugs.length ? categorySlugs.join(', ') : 'AI IMAGE, AI VIDEO, SMART SYSTEMS';
  const lines = [
    `Today is ${todayISO}. Find and write today's post about a newly launched or updated AI tool.`,
    '',
    `Allowed category slugs (choose the single best fit for "tag"): ${slugList}`,
  ];
  if (preferredTag) {
    lines.push(
      '',
      `For "tag", default to "${preferredTag}" for these daily AI-tool posts. Choose a more specific slug only when the tool clearly belongs to it (e.g. an AI image-generation tool → the image category, an AI video tool → the video category, a smart-systems product → that category).`
    );
  }
  lines.push(
    '',
    'ALREADY COVERED — do NOT write about any of these tools again:'
  );

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
    'Search for recently launched or updated AI tools, pick the single most noteworthy one NOT already covered above, then return the JSON object as specified.'
  );
  return lines.join('\n');
}
