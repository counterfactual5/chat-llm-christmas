/** Explicit deep-research command: `/research …` or `/研究 …`. */
const RESEARCH_CMD_RE = /^(?:\/research|\/研究)\s+([\s\S]+)$/i;

/** Returns the research query if the text is a research command; else null. */
export function parseResearchCommand(text: string): string | null {
  const m = String(text || '').trim().match(RESEARCH_CMD_RE);
  return m?.[1]?.trim() || null;
}

/** True when the composer looks like an incomplete `/research` prefix (no query yet). */
export function isResearchCommandPrefix(text: string): boolean {
  return /^(?:\/research|\/研究)\s*$/i.test(String(text || '').trim());
}
