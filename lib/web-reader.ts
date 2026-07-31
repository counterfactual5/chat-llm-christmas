/**
 * Multi-provider web page reader with fallback chain.
 * Order: Zhipu Coding Plan MCP → Tavily Extract → Jina → bare fetch.
 */

import {
  zhipuMcpEnabled,
  zhipuMcpWebRead,
} from '@/lib/zhipu-mcp';

export type WebReadOutcome = {
  provider: string;
  url: string;
  title?: string;
  description?: string;
  content: string;
  error?: string;
};

const MAX_CONTENT_CHARS = 48_000;

function tavilyApiKey(): string | undefined {
  return process.env.TAVILY_API_KEY?.trim() || undefined;
}

/** Keyless Extract is free but rate-limited; disable with TAVILY_EXTRACT_KEYLESS=0. */
function tavilyKeylessEnabled(): boolean {
  const flag = (process.env.TAVILY_EXTRACT_KEYLESS || '1').trim().toLowerCase();
  return flag !== '0' && flag !== 'false' && flag !== 'off';
}

function tavilyExtractAvailable(): boolean {
  return Boolean(tavilyApiKey()) || tavilyKeylessEnabled();
}

function jinaApiKey(): string | undefined {
  return process.env.JINA_API_KEY?.trim() || undefined;
}

const MIN_EXTRACT_CHARS = 40;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BARE_FETCH_TIMEOUT_MS = 15_000;
const PROVIDER_FETCH_TIMEOUT_MS = 25_000;
/** Cap HTML body read so one huge page cannot OOM the Edge isolate. */
const MAX_FETCH_BYTES = 2_500_000;

function codePointToChar(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') return true;
  if (host === '::1' || host === '[::1]') return true;
  if (host === 'metadata.google.internal') return true;

  // IPv4 literal (including decimal / short forms normalized by URL)
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const parts = ipv4.slice(1).map((p) => Number(p));
    if (parts.some((n) => n > 255)) return true;
    const [a, b] = parts;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    return false;
  }

  // IPv6 literals arrive without brackets from URL.hostname
  if (host.includes(':')) {
    if (host === '::1') return true;
    if (host.startsWith('fc') || host.startsWith('fd')) return true; // ULA
    if (host.startsWith('fe80')) return true; // link-local
    // IPv4-mapped IPv6 ::ffff:x.x.x.x
    const mapped = host.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
    if (mapped) return isBlockedHostname(mapped[1]);
  }

  return false;
}

function normalizeUrl(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (isBlockedHostname(u.hostname)) return null;
    return u.toString();
  } catch {
    try {
      const u = new URL(`https://${s}`);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      if (isBlockedHostname(u.hostname)) return null;
      return u.toString();
    } catch {
      return null;
    }
  }
}

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
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      codePointToChar(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      codePointToChar(Number.parseInt(dec, 10)),
    );
}

function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = String((err as { name?: string }).name || '');
  return name === 'TimeoutError' || name === 'AbortError';
}

async function readResponseTextLimited(
  res: Response,
  maxBytes = MAX_FETCH_BYTES,
): Promise<string> {
  const declared = Number(res.headers.get('content-length') || '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Response too large (${declared} bytes)`);
  }
  if (!res.body) return res.text();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      throw new Error(`Response too large (>${maxBytes} bytes)`);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
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
  const markers = [
    'window.__INITIAL_STATE__',
    'window.__NUXT__',
    'window.__PRELOADED_STATE__',
    'window.__APOLLO_STATE__',
  ];
  // Note: __NEXT_DATA__ is a <script id="__NEXT_DATA__" type="application/json">
  // whose body IS the JSON — handled via extractScriptJsonById, not here.
  for (const marker of markers) {
    let from = 0;
    while (from < html.length) {
      const idx = html.indexOf(marker, from);
      if (idx < 0) break;
      from = idx + marker.length;
      const eq = html.indexOf('=', from);
      if (eq < 0 || eq - from > 24) continue;
      const json = extractBalancedJsonObject(html, eq + 1);
      if (!json) continue;
      const parsed = parseJsonLenient(json);
      if (parsed != null) blocks.push(parsed);
      break; // one blob per marker is enough
    }
  }
  return blocks;
}

/** Extract a JSON object starting at/after `fromIndex`, respecting nested braces and strings. */
function extractBalancedJsonObject(source: string, fromIndex: number): string | null {
  const start = source.indexOf('{', fromIndex);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
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
  if (!zhipuMcpEnabled()) throw new Error('Zhipu MCP disabled');
  // Coding Plan MCP only — PaaS `/reader` bills balance and is unused here.
  // docs: https://docs.bigmodel.cn/cn/coding-plan/mcp/reader-mcp-server
  const mcp = await zhipuMcpWebRead(url);
  const content = truncateContent(mcp.content || '');
  if (!content) throw new Error('Zhipu MCP webReader returned empty content');
  return {
    provider: 'zhipu-mcp',
    url: mcp.url || url,
    title: mcp.title,
    description: mcp.description,
    content,
  };
}

/**
 * Tavily Extract — same free monthly credits as search (1k/mo with key),
 * or keyless rate-limited access. docs:
 * https://docs.tavily.com/documentation/api-reference/endpoint/extract
 */
async function readTavily(url: string): Promise<WebReadOutcome> {
  const key = tavilyApiKey();
  if (!key && !tavilyKeylessEnabled()) {
    throw new Error('Tavily extract unavailable');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  } else {
    headers['X-Tavily-Access-Mode'] = 'keyless';
  }

  let res: Response;
  try {
    res = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        urls: [url],
        format: 'markdown',
        extract_depth: 'basic',
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    if (isTimeoutError(err)) {
      throw new Error(`Tavily extract timed out after ${PROVIDER_FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  }

  const raw = await readResponseTextLimited(res, 1_500_000);
  if (!res.ok) {
    let message = `Tavily extract HTTP ${res.status}`;
    try {
      const err = JSON.parse(raw) as {
        detail?: { error?: string } | string;
        error?: string;
        message?: string;
      };
      const detail =
        typeof err.detail === 'string'
          ? err.detail
          : err.detail && typeof err.detail === 'object'
            ? err.detail.error
            : undefined;
      message = detail || err.error || err.message || message;
    } catch {
      // keep default
    }
    throw new Error(message);
  }

  const data = JSON.parse(raw) as {
    results?: Array<{ url?: string; title?: string; raw_content?: string }>;
    failed_results?: Array<{ url?: string; error?: string }>;
  };
  const hit = (data.results || []).find((r) => String(r.raw_content || '').trim());
  if (!hit) {
    const fail = data.failed_results?.[0]?.error || 'no content';
    throw new Error(`Tavily extract failed: ${fail}`);
  }
  const content = truncateContent(hit.raw_content || '');
  if (!content) throw new Error('Tavily extract returned empty content');
  return {
    provider: key ? 'tavily' : 'tavily-keyless',
    url: hit.url || url,
    title: hit.title || undefined,
    content,
  };
}

/**
 * Jina Reader: https://r.jina.ai/{url}
 * Requires JINA_API_KEY — free signup tokens run out; kept as optional fallback.
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

  let res: Response;
  try {
    res = await fetch(endpoint, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    if (isTimeoutError(err)) {
      throw new Error(`Jina reader timed out after ${PROVIDER_FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  }

  const contentType = res.headers.get('content-type') || '';
  const raw = await readResponseTextLimited(res, 1_500_000);

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
    if (isTimeoutError(err)) {
      throw new Error(`Fetch timed out after ${BARE_FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  }
  if (!res.ok) throw new Error(`Fetch HTTP ${res.status}`);
  // After redirects, refuse private/metadata hosts (DNS rebinding / open redirect).
  const finalHost = (() => {
    try {
      return new URL(res.url || url).hostname;
    } catch {
      return '';
    }
  })();
  if (finalHost && isBlockedHostname(finalHost)) {
    throw new Error('Blocked private or local URL after redirect');
  }
  const html = await readResponseTextLimited(res);
  const extracted = extractFromHtml(html);
  if (!extracted.content || extracted.content.length < MIN_EXTRACT_CHARS) {
    throw new Error('Bare fetch extracted too little text');
  }
  return {
    provider: 'fetch',
    url: res.url || url,
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
    available: () => zhipuMcpEnabled(),
    read: readZhipu,
  },
  {
    name: 'tavily',
    available: () => tavilyExtractAvailable(),
    read: readTavily,
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
    return {
      provider: 'none',
      url: '',
      content: '',
      error: 'Invalid, missing, or blocked URL',
    };
  }

  const errors: string[] = [];
  for (const provider of PROVIDERS) {
    if (!provider.available()) continue;
    try {
      return await provider.read(url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err || 'failed');
      errors.push(`${provider.name}: ${message}`);
      console.warn(`[web_read] ${provider.name} failed, trying next:`, message);
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
      'Fetch and extract the main text of a specific public webpage URL (after web_search or when the user gives a link). Returns title + cleaned markdown/text body. Use when snippets from search are not enough. Required: absolute http(s) `url` copied from a search result — never pass a search query string.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'Absolute http(s) URL to read, e.g. https://www.example.com/article. Must start with http:// or https://.',
        },
      },
      required: ['url'],
    },
  },
};
