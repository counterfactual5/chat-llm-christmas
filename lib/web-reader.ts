/**
 * Multi-provider web page reader with fallback chain.
 * Order: Zhipu → Jina (if JINA_API_KEY) → bare fetch (last resort).
 */

export type WebReadOutcome = {
  provider: string;
  url: string;
  title?: string;
  description?: string;
  content: string;
  error?: string;
};

const MAX_CONTENT_CHARS = 48_000;

function zhipuApiKey(): string | undefined {
  return (
    process.env.ZHIPU_API_KEY?.trim() ||
    process.env.ZHIPUAI_API_KEY?.trim() ||
    process.env.BIGMODEL_API_KEY?.trim() ||
    undefined
  );
}

function jinaApiKey(): string | undefined {
  return process.env.JINA_API_KEY?.trim() || undefined;
}

function normalizeUrl(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    try {
      const u = new URL(`https://${s}`);
      return u.toString();
    } catch {
      return null;
    }
  }
}

const MIN_EXTRACT_CHARS = 40;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function truncateContent(text: string): string {
  const t = String(text || '').trim();
  if (t.length <= MAX_CONTENT_CHARS) return t;
  return `${t.slice(0, MAX_CONTENT_CHARS)}\n\n…[truncated]`;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

function metaContent(html: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
    'i',
  );
  const m = html.match(re);
  const value = (m?.[1] || m?.[2] || '').trim();
  return value ? decodeHtmlEntities(value).replace(/\s+/g, ' ') : undefined;
}

function extractPageTitle(html: string): string | undefined {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const fromTitle = titleMatch?.[1]
    ? decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, ' ').trim()
    : '';
  if (fromTitle) return fromTitle;
  return metaContent(html, 'og:title') || metaContent(html, 'twitter:title');
}

function firstTagInner(html: string, tag: string): string | null {
  const openRe = new RegExp(`<(${tag})\\b[^>]*>`, 'i');
  const m = openRe.exec(html);
  if (!m) return null;
  return sliceBalancedInner(html, m.index + m[0].length, tag);
}

function firstRoleMainInner(html: string): string | null {
  const openRe = /<([a-z0-9]+)[^>]*\brole=["']main["'][^>]*>/i;
  const m = openRe.exec(html);
  if (!m) return null;
  return sliceBalancedInner(html, m.index + m[0].length, m[1].toLowerCase());
}

/** Drop noisy chrome; keep header inside article so article titles survive. */
function stripNoiseHtml(html: string, opts: { dropHeader: boolean }): string {
  let out = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, ' ');
  if (opts.dropHeader) {
    out = out.replace(/<header\b[\s\S]*?<\/header>/gi, ' ');
  }
  return out;
}

function htmlFragmentToText(html: string): string {
  let text = html
    .replace(/<\/?(h[1-6]|p|div|section|article|main|ul|ol|table|tr|blockquote|pre|hr)\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  text = decodeHtmlEntities(text);
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Slice inner HTML of a balanced tag starting after `start`. */
function sliceBalancedInner(html: string, start: number, tag: string): string | null {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 1;
  let i = start;
  while (depth > 0 && i < html.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return null;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      i = nextOpen.index + nextOpen[0].length;
    } else {
      depth -= 1;
      if (depth === 0) return html.slice(start, nextClose.index);
      i = nextClose.index + nextClose[0].length;
    }
  }
  return null;
}

function extractByOpenRegex(html: string, openRe: RegExp): string[] {
  const out: string[] = [];
  const re = new RegExp(openRe.source, openRe.flags.includes('g') ? openRe.flags : `${openRe.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = String(m[1] || 'div').toLowerCase();
    const start = m.index + m[0].length;
    const inner = sliceBalancedInner(html, start, tag);
    if (inner && inner.trim().length >= 20) out.push(inner);
    if (out.length >= 8) break;
  }
  return out;
}

const CONTENT_CLASS_NAMES = [
  'post-content',
  'entry-content',
  'article-content',
  'article-body',
  'post-body',
  'markdown-body',
  'md-content',
  'prose',
  'rich-text',
  'story-body',
  'article__content',
  'content-body',
  'main-content',
  'page-content',
];

const CONTENT_IDS = ['content', 'main-content', 'article-body', 'post-content', 'readme'];

/** Cap total selector candidates so one huge, class-heavy page can't blow up scan cost. */
const MAX_SELECTOR_CANDIDATES = 24;

/** CMS / docs content regions via class, id, or itemprop. */
function extractContentSelectorInners(html: string): string[] {
  const found: string[] = [];
  const addAll = (inners: string[]) => {
    for (const inner of inners) {
      if (found.length >= MAX_SELECTOR_CANDIDATES) return;
      found.push(inner);
    }
  };

  for (const cls of CONTENT_CLASS_NAMES) {
    if (found.length >= MAX_SELECTOR_CANDIDATES) break;
    const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const openRe = new RegExp(
      `<(div|section|article|main|aside)\\b[^>]*\\bclass=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>`,
      'gi',
    );
    addAll(extractByOpenRegex(html, openRe));
  }
  for (const id of CONTENT_IDS) {
    if (found.length >= MAX_SELECTOR_CANDIDATES) break;
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const openRe = new RegExp(
      `<(div|section|article|main)\\b[^>]*\\bid=["']${escaped}["'][^>]*>`,
      'gi',
    );
    addAll(extractByOpenRegex(html, openRe));
  }
  if (found.length < MAX_SELECTOR_CANDIDATES) {
    addAll(
      extractByOpenRegex(
        html,
        /<(div|section|article|main)\b[^>]*\bitemprop=["']articleBody["'][^>]*>/gi,
      ),
    );
  }
  if (found.length < MAX_SELECTOR_CANDIDATES) {
    addAll(
      extractByOpenRegex(
        html,
        /<(div|section|article|main)\b[^>]*\bdata-testid=["'][^"']*content[^"']*["'][^>]*>/gi,
      ),
    );
  }
  return found;
}

/**
 * Lightweight Readability-style score: reward long paragraphs / punctuation,
 * penalize link-heavy chrome and lots of tiny nav lines.
 */
function scoreExtractedText(text: string, sourceHtml: string, bias = 0): number {
  const len = text.length;
  if (len < MIN_EXTRACT_CHARS) return 0;

  const paragraphs = text
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const longParas = paragraphs.filter((p) => p.length >= 80).length;
  const mediumParas = paragraphs.filter((p) => p.length >= 40).length;
  const shortLines = paragraphs.filter((p) => p.length > 0 && p.length < 25).length;
  const punct = (text.match(/[,，.。!！?？;；:：]/g) || []).length;
  const linkCount = (sourceHtml.match(/<a\b/gi) || []).length;
  const linkDensity = linkCount / Math.max(1, len / 100);

  let score = Math.sqrt(len) * 12 + bias;
  score += longParas * 140;
  score += mediumParas * 35;
  score += Math.min(punct, 80) * 6;
  score -= linkDensity * 90;
  score -= shortLines * 18;
  return score;
}

type HtmlCandidate = {
  html: string;
  dropHeader: boolean;
  bias: number;
  label: string;
};

const CONTENTISH_KEYS = new Set([
  'articlebody',
  'text',
  'content',
  'body',
  'description',
  'markdown',
  'html',
  'plaintext',
  'summary',
  'abstract',
  'headline',
  'title',
  'name',
]);

const SKIP_JSON_KEYS = /^(id|slug|url|href|src|image|images|icon|logo|hash|token|csrf|cookie|pathname|query|buildid|page|props|pageprops|__n[a-z]*)$/i;

function looksLikeProse(text: string): boolean {
  const t = text.trim();
  if (t.length < 80) return false;
  if (/^https?:\/\//i.test(t) && !/\s/.test(t)) return false;
  if (/^[\w./:@+-]+$/.test(t) && t.length < 200) return false;
  // Prefer strings with spaces/newlines (real copy), not UUIDs / class names.
  return /[\s\n]/.test(t) || t.length >= 200;
}

/** Walk JSON blobs and pull long prose-like string values. */
function collectProseFromJson(value: unknown, out: string[], depth = 0): void {
  if (depth > 14) return;
  if (out.reduce((n, s) => n + s.length, 0) > MAX_CONTENT_CHARS * 2) return;

  if (typeof value === 'string') {
    const decoded = value.includes('<') ? htmlFragmentToText(value) : decodeHtmlEntities(value).trim();
    if (looksLikeProse(decoded)) out.push(decoded);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectProseFromJson(item, out, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const obj = value as Record<string, unknown>;
  const preferred: unknown[] = [];
  const rest: unknown[] = [];
  for (const [key, child] of Object.entries(obj)) {
    if (SKIP_JSON_KEYS.test(key)) continue;
    if (CONTENTISH_KEYS.has(key.toLowerCase())) preferred.push(child);
    else rest.push(child);
  }
  for (const child of preferred) collectProseFromJson(child, out, depth + 1);
  for (const child of rest) collectProseFromJson(child, out, depth + 1);
}

function joinProseChunks(chunks: string[]): string {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const chunk of chunks) {
    const key = chunk.slice(0, 160);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(chunk);
  }
  // Prefer fewer, longer chunks — drop short ones subsumed by longer text.
  unique.sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  for (const chunk of unique) {
    if (kept.some((k) => k.includes(chunk.slice(0, Math.min(120, chunk.length))))) continue;
    kept.push(chunk);
    if (kept.join('\n\n').length >= MAX_CONTENT_CHARS) break;
  }
  return kept.join('\n\n').trim();
}

function parseJsonLenient(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    // Some pages emit JS object literals with trailing commas.
    try {
      const cleaned = raw
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/([{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g, '$1"$2":');
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

function extractScriptJsonById(html: string, id: string): unknown | null {
  const re = new RegExp(
    `<script[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`,
    'i',
  );
  const m = html.match(re);
  if (!m?.[1]) return null;
  return parseJsonLenient(m[1].trim());
}

function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const parsed = parseJsonLenient(m[1].trim());
    if (parsed != null) blocks.push(parsed);
  }
  return blocks;
}

function extractInlineStateJson(html: string): unknown[] {
  const blocks: unknown[] = [];
  const patterns = [
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i,
    /window\.__NUXT__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i,
    /window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i,
    /window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i,
  ];
  // Note: __NEXT_DATA__ is a <script id="__NEXT_DATA__" type="application/json">
  // whose body IS the JSON (no "window.__NEXT_DATA__ = " prefix) — handled
  // separately via extractScriptJsonById, not this window-assignment pattern list.
  for (const re of patterns) {
    const m = html.match(re);
    if (!m?.[1]) continue;
    const parsed = parseJsonLenient(m[1]);
    if (parsed != null) blocks.push(parsed);
  }
  return blocks;
}

function textFromJsonLd(blocks: unknown[]): { title?: string; description?: string; content: string } {
  const chunks: string[] = [];
  let title: string | undefined;
  let description: string | undefined;

  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj['@graph'])) visit(obj['@graph']);

    const typeRaw = obj['@type'];
    const types = Array.isArray(typeRaw)
      ? typeRaw.map(String)
      : typeRaw
        ? [String(typeRaw)]
        : [];
    const isArticle = types.some((t) =>
      /Article|BlogPosting|NewsArticle|TechArticle|WebPage|FAQPage/i.test(t),
    );

    const headline = typeof obj.headline === 'string' ? obj.headline.trim() : '';
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    if (!title && (headline || name)) title = decodeHtmlEntities(headline || name);

    const desc =
      typeof obj.description === 'string' ? obj.description.trim() : '';
    if (!description && desc) description = decodeHtmlEntities(desc);

    const body =
      (typeof obj.articleBody === 'string' && obj.articleBody) ||
      (typeof obj.text === 'string' && obj.text) ||
      '';
    if (body) {
      const text = body.includes('<') ? htmlFragmentToText(body) : decodeHtmlEntities(body).trim();
      if (text.length >= MIN_EXTRACT_CHARS) chunks.push(text);
    } else if (isArticle) {
      collectProseFromJson(obj, chunks);
    }
  };

  for (const block of blocks) visit(block);
  return { title, description, content: joinProseChunks(chunks) };
}

function textFromEmbeddedJson(html: string): { title?: string; description?: string; content: string } {
  const chunks: string[] = [];
  let title: string | undefined;
  let description: string | undefined;

  const nextData = extractScriptJsonById(html, '__NEXT_DATA__');
  if (nextData && typeof nextData === 'object') {
    const props = (nextData as { props?: { pageProps?: Record<string, unknown> } }).props?.pageProps;
    if (props) {
      if (typeof props.title === 'string' && props.title.trim()) {
        title = decodeHtmlEntities(props.title.trim());
      }
      if (typeof props.description === 'string' && props.description.trim()) {
        description = decodeHtmlEntities(props.description.trim());
      }
      collectProseFromJson(props, chunks);
    } else {
      collectProseFromJson(nextData, chunks);
    }
  }

  for (const state of extractInlineStateJson(html)) {
    collectProseFromJson(state, chunks);
  }

  const ld = textFromJsonLd(extractJsonLdBlocks(html));
  if (!title && ld.title) title = ld.title;
  if (!description && ld.description) description = ld.description;
  if (ld.content) chunks.push(ld.content);

  return { title, description, content: joinProseChunks(chunks) };
}

type ExtractedPage = {
  title?: string;
  description?: string;
  content: string;
};

/** Prefer content selectors / article/main via density score; JSON when DOM is a shell. */
function extractFromHtml(html: string): ExtractedPage {
  let title = extractPageTitle(html);
  let description =
    metaContent(html, 'og:description') ||
    metaContent(html, 'description') ||
    metaContent(html, 'twitter:description');

  const article = firstTagInner(html, 'article');
  const main = firstTagInner(html, 'main') || firstRoleMainInner(html);
  const body = firstTagInner(html, 'body');

  const htmlCandidates: HtmlCandidate[] = [];
  for (const inner of extractContentSelectorInners(html)) {
    htmlCandidates.push({
      html: inner,
      dropHeader: false,
      bias: 5200,
      label: 'selector',
    });
  }
  if (article) {
    htmlCandidates.push({ html: article, dropHeader: false, bias: 3200, label: 'article' });
  }
  if (main) {
    htmlCandidates.push({ html: main, dropHeader: true, bias: 2200, label: 'main' });
  }
  if (body) {
    htmlCandidates.push({ html: body, dropHeader: true, bias: 400, label: 'body' });
  }
  htmlCandidates.push({ html, dropHeader: true, bias: 0, label: 'full' });

  let bestHtml = '';
  let bestScore = -1;
  let bestLabel = 'full';
  for (const candidate of htmlCandidates) {
    const cleaned = stripNoiseHtml(candidate.html, { dropHeader: candidate.dropHeader });
    const text = htmlFragmentToText(cleaned);
    const score = scoreExtractedText(text, cleaned, candidate.bias);
    if (score > bestScore || (score === bestScore && text.length > bestHtml.length)) {
      bestScore = score;
      bestHtml = text;
      bestLabel = candidate.label;
    }
  }

  const embedded = textFromEmbeddedJson(html);
  if (!title && embedded.title) title = embedded.title;
  if (!description && embedded.description) description = embedded.description;

  let content = bestHtml;
  if (embedded.content) {
    const embeddedScore = scoreExtractedText(embedded.content, '', 1800);
    const htmlWeak =
      bestScore < 800 ||
      bestLabel === 'body' ||
      bestLabel === 'full' ||
      bestHtml.length < MIN_EXTRACT_CHARS * 3;
    if (
      (htmlWeak && embeddedScore >= bestScore) ||
      (bestHtml.length < MIN_EXTRACT_CHARS && embedded.content.length >= MIN_EXTRACT_CHARS)
    ) {
      content = embedded.content;
    } else if (embedded.content.length > bestHtml.length * 1.4 && embeddedScore > bestScore * 0.85) {
      content = embedded.content;
    }
  }

  return { title, description, content: truncateContent(content) };
}

async function readZhipu(url: string): Promise<WebReadOutcome> {
  const key = zhipuApiKey();
  if (!key) throw new Error('ZHIPU_API_KEY missing');

  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/reader', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      timeout: 20,
      return_format: 'markdown',
      retain_images: false,
      with_links_summary: false,
    }),
    cache: 'no-store',
  });

  const data = (await res.json().catch(() => ({}))) as {
    reader_result?: {
      content?: string;
      description?: string;
      title?: string;
      url?: string;
    };
    error?: { code?: string; message?: string };
  };

  if (!res.ok) {
    throw new Error(
      data.error?.message || data.error?.code || `Zhipu reader HTTP ${res.status}`,
    );
  }

  const result = data.reader_result || {};
  const content = truncateContent(result.content || '');
  if (!content) throw new Error('Zhipu reader returned empty content');

  return {
    provider: 'zhipu',
    url: result.url || url,
    title: result.title || undefined,
    description: result.description || undefined,
    content,
  };
}

/**
 * Jina Reader: https://r.jina.ai/{url}
 * Requires JINA_API_KEY — anonymous access is unreliable / often blocked from
 * server IPs, and authenticated usage is token-billed after the signup grant.
 */
async function readJina(url: string): Promise<WebReadOutcome> {
  const key = jinaApiKey();
  if (!key) throw new Error('JINA_API_KEY missing');

  const endpoint = `https://r.jina.ai/${url}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Return-Format': 'markdown',
    Authorization: `Bearer ${key}`,
  };

  const res = await fetch(endpoint, { headers, cache: 'no-store' });
  const contentType = res.headers.get('content-type') || '';
  const raw = await res.text();

  if (!res.ok) {
    let message = `Jina reader HTTP ${res.status}`;
    try {
      const err = JSON.parse(raw) as { message?: string; readableMessage?: string };
      message = err.readableMessage || err.message || message;
    } catch {
      // keep default
    }
    throw new Error(message);
  }

  if (contentType.includes('application/json')) {
    const data = JSON.parse(raw) as {
      data?: { title?: string; description?: string; url?: string; content?: string };
      title?: string;
      description?: string;
      url?: string;
      content?: string;
    };
    const page = data.data || data;
    const content = truncateContent(page.content || '');
    if (!content) throw new Error('Jina reader returned empty content');
    return {
      provider: 'jina',
      url: page.url || url,
      title: page.title || undefined,
      description: page.description || undefined,
      content,
    };
  }

  const content = truncateContent(raw);
  if (!content) throw new Error('Jina reader returned empty content');
  return { provider: 'jina', url, content };
}

const BARE_FETCH_TIMEOUT_MS = 15_000;

/** Last resort: plain HTTP GET + structured HTML extract (no JS rendering). */
async function readBareFetch(url: string): Promise<WebReadOutcome> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
      },
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(BARE_FETCH_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error(`Fetch timed out after ${BARE_FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  }
  if (!res.ok) throw new Error(`Fetch HTTP ${res.status}`);
  const html = await res.text();
  const extracted = extractFromHtml(html);
  if (!extracted.content || extracted.content.length < MIN_EXTRACT_CHARS) {
    throw new Error('Bare fetch extracted too little text');
  }
  return {
    provider: 'fetch',
    url,
    title: extracted.title,
    description: extracted.description,
    content: extracted.content,
  };
}

type ReaderProvider = {
  name: string;
  available: () => boolean;
  read: (url: string) => Promise<WebReadOutcome>;
};

const PROVIDERS: ReaderProvider[] = [
  {
    name: 'zhipu',
    available: () => Boolean(zhipuApiKey()),
    read: readZhipu,
  },
  {
    name: 'jina',
    available: () => Boolean(jinaApiKey()),
    read: readJina,
  },
  {
    name: 'fetch',
    available: () => true,
    read: readBareFetch,
  },
];

/** Run the fallback chain until one provider returns page content. */
export async function webRead(urlInput: string): Promise<WebReadOutcome> {
  const url = normalizeUrl(urlInput);
  if (!url) {
    return { provider: 'none', url: '', content: '', error: 'Invalid or missing URL' };
  }

  const errors: string[] = [];
  for (const provider of PROVIDERS) {
    if (!provider.available()) continue;
    try {
      return await provider.read(url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err || 'failed');
      errors.push(`${provider.name}: ${message}`);
    }
  }

  return {
    provider: 'none',
    url,
    content: '',
    error: errors.join(' | ') || 'All readers failed',
  };
}

export function formatWebReadForModel(outcome: WebReadOutcome): string {
  if (!outcome.content) {
    return JSON.stringify({
      ok: false,
      url: outcome.url,
      provider: outcome.provider,
      error: outcome.error || 'Failed to read page',
      guidance: 'Tell the user the page could not be fetched. Do not invent page contents.',
    });
  }

  return JSON.stringify({
    ok: true,
    provider: outcome.provider,
    url: outcome.url,
    title: outcome.title || null,
    description: outcome.description || null,
    content: outcome.content,
    guidance:
      'This IS the full-page extract. Cite the URL when answering. Do not claim you could not read the page if content is present.',
  });
}

export const WEB_READ_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_read',
    description:
      'Fetch and extract the main text of a specific public webpage URL (after web_search or when the user gives a link). Returns title + cleaned markdown/text body. Use when snippets from search are not enough.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Absolute http(s) URL to read.',
        },
      },
      required: ['url'],
    },
  },
};
