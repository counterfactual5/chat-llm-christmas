/** Explicit deep-research command: `/research …` or `/研究 …`. */
const RESEARCH_CMD_RE = /^(?:\/research|\/研究)\s+([\s\S]+)$/i;

export type ResearchModeHint = 'quick' | 'standard' | 'rigorous';

/** Optional leading mode keyword, e.g. `/research quick <query>` or `/research 深度 <query>`. */
const MODE_ALIASES: Record<string, ResearchModeHint> = {
  quick: 'quick',
  fast: 'quick',
  快速: 'quick',
  standard: 'standard',
  normal: 'standard',
  标准: 'standard',
  rigorous: 'rigorous',
  deep: 'rigorous',
  thorough: 'rigorous',
  深度: 'rigorous',
  严谨: 'rigorous',
};

export type ParsedResearchCommand = { query: string; mode?: ResearchModeHint };

/** Canonical slash text shown in the user bubble (keeps the chosen depth visible). */
export function formatResearchCommand(query: string, mode?: ResearchModeHint): string {
  const q = String(query || '').trim();
  if (!q) return '/research ';
  return mode ? `/research ${mode} ${q}` : `/research ${q}`;
}

/** Returns the research query (and optional mode hint) if the text is a research command; else null. */
export function parseResearchCommand(text: string): ParsedResearchCommand | null {
  const m = String(text || '').trim().match(RESEARCH_CMD_RE);
  const rest = m?.[1]?.trim();
  if (!rest) return null;
  const modeMatch = rest.match(/^([a-zA-Z\u4e00-\u9fa5]+)\s+([\s\S]+)$/);
  if (modeMatch) {
    const mode = MODE_ALIASES[modeMatch[1].toLowerCase()];
    if (mode) return { query: modeMatch[2].trim(), mode };
  }
  return { query: rest };
}

/** True when the composer looks like an incomplete `/research` prefix (no query yet). */
export function isResearchCommandPrefix(text: string): boolean {
  return /^(?:\/research|\/研究)\s*$/i.test(String(text || '').trim());
}
