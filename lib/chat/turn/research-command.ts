/** Explicit deep-research command: `/research …` or `/研究 …`. */
const RESEARCH_CMD_RE = /^(?:\/research|\/研究)\s+([\s\S]+)$/i;

export type ResearchModeHint = 'quick' | 'standard' | 'rigorous';
export type ResearchSourcesHint = 'web' | 'literature' | 'mixed';

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

/** Optional source lane after depth: `/research standard literature <query>`. */
const SOURCE_ALIASES: Record<string, ResearchSourcesHint> = {
  web: 'web',
  网页: 'web',
  literature: 'literature',
  academic: 'literature',
  papers: 'literature',
  books: 'literature',
  学术: 'literature',
  文献: 'literature',
  mixed: 'mixed',
  all: 'mixed',
  混合: 'mixed',
};

export type ParsedResearchCommand = {
  query: string;
  mode?: ResearchModeHint;
  sources?: ResearchSourcesHint;
};

/** Canonical slash text shown in the user bubble (keeps chosen depth/source visible). */
export function formatResearchCommand(
  query: string,
  mode?: ResearchModeHint,
  sources?: ResearchSourcesHint,
): string {
  const q = String(query || '').trim();
  if (!q) return '/research ';
  const parts = ['/research'];
  if (mode) parts.push(mode);
  if (sources) parts.push(sources);
  parts.push(q);
  return parts.join(' ');
}

/** Returns query (+ optional mode / sources) if the text is a research command; else null. */
export function parseResearchCommand(text: string): ParsedResearchCommand | null {
  const m = String(text || '').trim().match(RESEARCH_CMD_RE);
  let rest: string = m?.[1]?.trim() || '';
  if (!rest) return null;
  let mode: ResearchModeHint | undefined;
  let sources: ResearchSourcesHint | undefined;
  for (let i = 0; i < 2; i++) {
    const tokenMatch = rest.match(/^([a-zA-Z\u4e00-\u9fa5]+)\s+([\s\S]+)$/);
    if (!tokenMatch) break;
    const key = tokenMatch[1].toLowerCase();
    if (!mode && MODE_ALIASES[key]) {
      mode = MODE_ALIASES[key];
      rest = tokenMatch[2].trim();
      continue;
    }
    if (!sources && SOURCE_ALIASES[key]) {
      sources = SOURCE_ALIASES[key];
      rest = tokenMatch[2].trim();
      continue;
    }
    break;
  }
  return rest ? { query: rest, ...(mode ? { mode } : {}), ...(sources ? { sources } : {}) } : null;
}

/** True when the composer looks like an incomplete `/research` prefix (no query yet). */
export function isResearchCommandPrefix(text: string): boolean {
  return /^(?:\/research|\/研究)\s*$/i.test(String(text || '').trim());
}
