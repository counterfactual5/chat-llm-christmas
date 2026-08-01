import type { Message } from '@/lib/chat/types';

/**
 * Build S1..Sn → URL from the research_sources tool run (or any http results
 * collected during the research turn).
 */
export function researchSourceUrlMap(message: Message): Map<number, string> {
  const map = new Map<number, string>();
  const sourcesRun = (message.toolRuns || []).find((r) => r.name === 'research_sources');
  const results = sourcesRun?.results || [];
  results.forEach((hit, i) => {
    const url = String(hit?.url || '').trim();
    if (/^https?:\/\//i.test(url)) map.set(i + 1, url);
  });
  return map;
}

/**
 * Make bare [S1] citations and source-list rows clickable markdown links.
 * Safe to run on already-linked text (skips `[S1](...)`).
 */
export function linkifyResearchCitations(
  markdown: string,
  sourceUrls: Map<number, string>,
): string {
  if (!markdown || !sourceUrls.size) return markdown;

  let text = markdown;

  // Source-list rows: "- [S1] Some title" → "- [S1] [Some title](url)"
  text = text.replace(
    /^(\s*[-*]\s*)?\[S(\d+)\]\s+(?!\()(.+)$/gm,
    (full, bullet, num, rest) => {
      const url = sourceUrls.get(Number(num));
      if (!url) return full;
      const prefix = bullet || '';
      if (/^\[[^\]]+\]\([^)]+\)/.test(String(rest).trim())) {
        return `${prefix}[S${num}] ${rest}`;
      }
      const label = String(rest).trim();
      return `${prefix}[S${num}] [${label}](${url})`;
    },
  );

  // Inline [Sn]: link each citation, including adjacent [S8][S10].
  // Skip source-list form "[Sn] [title](url)".
  text = text.replace(/\[S(\d+)\](?!\()/g, (full, num, offset, whole) => {
    const rest = whole.slice(offset + full.length);
    if (/^ \[[^\]]+\]\(/.test(rest)) return full;
    const url = sourceUrls.get(Number(num));
    if (!url) return full;
    return `[S${num}](${url})`;
  });

  return text;
}
