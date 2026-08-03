import type { ExecutionRecordEntry, ExecutionSource } from '@/lib/tools/review/core/types';

// Exclude markdown glue (`*`, fullwidth parens) so `**https://…**（搜索` does not
// swallow `**` / `（` into the match — same class of bug as fixBoldWrappedUrls.
const URL_RE = /https?:\/\/[^\s"'`<>()\[\]{}\\|*\uFF08\uFF09]+/gi;

/** Drop trailing punctuation / markdown markers that prose glues onto a URL. */
export function trimUrlTail(raw: string): string {
  let out = String(raw || '');
  // Stacked glue is common: `url**)` / `url**（` / `url),`
  let prev = '';
  while (out !== prev) {
    prev = out;
    out = out.replace(/[.,;:!?)\]}'"*_+”』」）】》›»]+$/u, '');
  }
  return out;
}

/** Host + path identity so tracking params / anchors don't cause false mismatches. */
export function normalizeUrl(raw: string): string {
  const cleaned = trimUrlTail(raw);
  try {
    const u = new URL(cleaned);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${path}`;
  } catch {
    return cleaned.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
}

export function extractUrls(text: string, limit = 60): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of String(text || '').matchAll(URL_RE)) {
    const url = trimUrlTail(match[0]);
    if (!url) continue;
    const key = normalizeUrl(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

/** Hosts that are never real citations (examples, local dev, spec boilerplate). */
const NON_CITATION_HOST_RE =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|.*\.local|example\.(com|org|net)|your-domain\.\w+|w3\.org|json-schema\.org|schema\.org|placeholder\.\w+)$/i;

export { NON_CITATION_HOST_RE };

export function hostOf(url: string): string {
  try {
    return new URL(trimUrlTail(url)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Retrieval-style receipts are what make citations verifiable. */
export function hasRetrievalReceipt(record: ExecutionRecordEntry[]): boolean {
  return record.some(
    (e) =>
      e.ok &&
      ((e.urls?.length || 0) > 0 ||
        (e.sources?.length || 0) > 0 ||
        /search|fetch|read|list|query|get|retrieve/i.test(e.tool)),
  );
}

/** Freshness only follows live web lookup — not image understand / Notion / etc. */
export function hasWebSearchOrReadReceipt(record: ExecutionRecordEntry[]): boolean {
  return record.some(
    (e) =>
      e.ok &&
      /^(web_search|web_read|web-read|proactive_search|read_url)$/i.test(
        String(e.tool || '').trim(),
      ),
  );
}

export function collectSources(record: ExecutionRecordEntry[]): ExecutionSource[] {
  const out: ExecutionSource[] = [];
  const byKey = new Map<string, ExecutionSource>();
  for (const entry of record) {
    const hits: ExecutionSource[] =
      entry.sources?.length
        ? entry.sources
        : (entry.urls || []).map((url) => ({ url }));
    for (const hit of hits) {
      const key = normalizeUrl(hit.url);
      if (!key) continue;
      const prev = byKey.get(key);
      if (!prev) {
        const copy = {
          url: hit.url,
          title: hit.title,
          snippet: hit.snippet,
        };
        byKey.set(key, copy);
        out.push(copy);
        continue;
      }
      if (String(hit.title || '').length > String(prev.title || '').length) {
        prev.title = hit.title;
      }
      if (String(hit.snippet || '').length > String(prev.snippet || '').length) {
        prev.snippet = hit.snippet;
      }
    }
  }
  return out;
}

export function clauseBefore(text: string, idx: number, lookback = 120): string {
  let before = text.slice(Math.max(0, idx - lookback), idx);
  // Lookback often starts mid-word / mid-`**bold**` — advance to a boundary so
  // Review titles don't show as "ek V4**，…".
  if (idx > lookback) {
    const boundary = before.search(/[\s\n。！？、，,;；:：]/);
    if (boundary > 0 && boundary < before.length - 8) {
      before = before.slice(boundary + 1);
    }
  }
  const parts = before.split(/[\n。！？]|[.!?](?=\s|$)/);
  return parts.pop()?.trim() || '';
}

export function clauseAfter(text: string, end: number, lookahead = 160): string {
  const after = text.slice(end, Math.min(text.length, end + lookahead));
  const parts = after.split(/[\n。！？]|[.!?](?=\s|$)/);
  return parts[0]?.trim() || '';
}

/** Strip fenced code blocks — code often contains deliberately wrong sample math. */
export function stripCodeBlocks(text: string): string {
  return String(text || '').replace(/```[\s\S]*?(?:```|$)/g, '\n');
}

export function parseNumberToken(raw: string): number {
  return parseFloat(String(raw).replace(/[,\s_]/g, ''));
}

type CodeBlock = { lang: string; code: string };

/** Fenced code blocks with their declared language (unterminated tail included). */
export function extractCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const re = /```([\w+#.-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g;
  for (const match of String(text || '').matchAll(re)) {
    const code = match[2] || '';
    if (code.trim()) blocks.push({ lang: (match[1] || '').toLowerCase(), code });
  }
  return blocks;
}

export function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:-]*-{2,}[\s|:-]*\|?\s*$/.test(line) && line.includes('-');
}

function splitSentences(text: string): string[] {
  return String(text || '')
    .split(/(?<=[。！？；;!?])\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function yearsIn(text: string): number[] {
  return [...String(text || '').matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
}

export { splitSentences, yearsIn };

export function extractNumericTokens(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text || '').matchAll(/\d+(?:[.,]\d+)*%?/g)) {
    const norm = m[0].replace(/,/g, '');
    if (norm.length >= 2) out.add(norm);
  }
  return [...out];
}

export function titleWords(text: string): Set<string> {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1e6) / 1e6);
}

/** Compact receipt list for the Review panel — not the full verifier dump. */
export function formatExecutionRecordForUi(record: ExecutionRecordEntry[]): string {
  if (!record.length) return '';
  return record
    .map((e, i) => {
      const status = e.ok ? 'ok' : 'failed';
      const hits = e.urls?.length || e.sources?.length || 0;
      const parts = [`${i + 1}. ${e.tool} (${status})`];
      if (e.query) parts.push(e.query.slice(0, 72));
      if (hits) parts.push(`${hits} hit(s)`);
      if (!e.ok && e.error) parts.push(e.error.slice(0, 100));
      return parts.join(' · ');
    })
    .join('\n');
}
