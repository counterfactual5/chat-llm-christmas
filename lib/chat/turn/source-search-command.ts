/** Dedicated search-path commands: `/news …`, `/wiki …`. */

const NEWS_CMD_RE = /^(?:\/news|\/新闻|\/资讯)\s+([\s\S]+)$/i;
const WIKI_CMD_RE = /^(?:\/wiki|\/wikipedia|\/百科|\/维基)\s+([\s\S]+)$/i;

export type SourceSearchKind = 'news' | 'wiki';

export type SourceSearchCommand = {
  kind: SourceSearchKind;
  query: string;
  lang?: 'en' | 'zh';
};

function normalizeQuery(raw: string): string {
  const original = String(raw || '').trim();
  if (!original) return '';
  const q = original
    .replace(
      /^(请|麻烦)?(帮我|给我|帮|请帮我|请给我)?\s*(找找|找一下|找下|搜搜|搜一下|搜索一下|搜索|查一下|查下|查找|看看)\s*/u,
      '',
    )
    .replace(/^(please\s+)?(find|search(\s+for)?|look\s+up)\s+/i, '')
    .replace(/[？?！!。.]+$/u, '')
    .trim();
  return q || original;
}

/** Returns news/wiki command if text matches; else null. */
export function parseSourceSearchCommand(text: string): SourceSearchCommand | null {
  const raw = String(text || '').trim().replace(/^／/u, '/');
  const news = raw.match(NEWS_CMD_RE);
  if (news?.[1]?.trim()) {
    return { kind: 'news', query: normalizeQuery(news[1]) };
  }
  const wiki = raw.match(WIKI_CMD_RE);
  if (wiki?.[1]?.trim()) {
    let rest = wiki[1].trim();
    let lang: 'en' | 'zh' | undefined;
    const langMatch = rest.match(/^(zh|en|中文|英文)\s+([\s\S]+)$/i);
    if (langMatch) {
      const token = langMatch[1].toLowerCase();
      lang = token === 'zh' || token === '中文' ? 'zh' : 'en';
      rest = langMatch[2].trim();
    }
    const query = normalizeQuery(rest);
    if (!query) return null;
    return { kind: 'wiki', query, ...(lang ? { lang } : {}) };
  }
  return null;
}

export function formatSourceSearchCommand(
  kind: SourceSearchKind,
  query: string,
  opts?: { lang?: 'en' | 'zh' },
): string {
  const q = String(query || '').trim();
  if (kind === 'news') return q ? `/news ${q}` : '/news ';
  if (opts?.lang) return q ? `/wiki ${opts.lang} ${q}` : `/wiki ${opts.lang} `;
  return q ? `/wiki ${q}` : '/wiki ';
}

export function isSourceSearchCommandPrefix(text: string): boolean {
  return /^(?:\/news|\/新闻|\/资讯|\/wiki|\/wikipedia|\/百科|\/维基)\s*$/i.test(
    String(text || '').trim().replace(/^／/u, '/'),
  );
}
