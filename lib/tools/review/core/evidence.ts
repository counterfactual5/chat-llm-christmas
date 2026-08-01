/**
 * Evidence layer for Review — the substrate every claim check verifies against.
 *
 * Borrowed from open-source review architectures:
 *  - foundry-research `evidence_units`: claims are checked against structured
 *    units with provenance, not the live web. Verdicts:
 *    confirmed | contradicted | partially_supported | unverifiable.
 *  - OpenScience `reviewer`: a number that cannot be traced to a concrete tool
 *    output is presumed fabricated; a finding without evidence is an opinion.
 *    Severity: blocking | major | minor | info. Gate levels L0/L1/L2.
 *
 * Critical distinction: evidence STRENGTH. A search blurb is a headline, not
 * an article. Missing from a blurb → unverifiable (warn). Missing from a
 * web_read body → unsupported (error, may drive correction).
 */

export type EvidenceKind =
  /** Search-result title + snippet — a headline, never the article. */
  | 'blurb'
  /** Extracted page text from web_read — strong enough to contradict a claim. */
  | 'body'
  /** Any other tool payload (Notion page, GitHub issue, …). */
  | 'payload';

export type EvidenceStrength = 'strong' | 'moderate' | 'weak';

/** Foundry claim-verifier style verdicts (+ unsupported for strong-miss). */
export type ClaimVerdict =
  | 'confirmed'
  | 'contradicted'
  | 'partially_supported'
  | 'unverifiable'
  | 'unsupported';

export type EvidenceUnit = {
  id: string;
  /** Canonical URL this evidence belongs to (empty for URL-less payloads). */
  url: string;
  title?: string;
  /** Searchable text: title + snippet, or extracted body. */
  text: string;
  kind: EvidenceKind;
  strength: EvidenceStrength;
  /** Tool that produced it (web_search / web_read / notion / …). */
  tool: string;
};

/** OpenScience-style severity; maps onto our Review error/warn UI. */
export type ReviewSeverityGrade = 'blocking' | 'major' | 'minor' | 'info';

/**
 * Gate levels (OpenScience docs/plans/11-reviewer-agent.md):
 *  - 0 annotate: panel only, never auto-correct
 *  - 1 soft: high-confidence errors may drive a bounded correction note (default)
 *  - 2 hard: same as soft in chat (we cannot refuse to show the answer), but
 *    correction is attempted for every actionable error
 */
export type ReviewGateLevel = 0 | 1 | 2;

const STRENGTH_BY_KIND: Record<EvidenceKind, EvidenceStrength> = {
  body: 'strong',
  payload: 'moderate',
  blurb: 'weak',
};

const STRENGTH_RANK: Record<EvidenceStrength, number> = {
  strong: 3,
  moderate: 2,
  weak: 1,
};

/** Body text is worth keeping at length — it is what makes a claim checkable. */
const MAX_BODY_CHARS = 20_000;
const MAX_BLURB_CHARS = 800;
const MAX_PAYLOAD_CHARS = 4_000;

const URL_RE = /https?:\/\/[^\s"'`<>()\[\]{}\\|]+/gi;

export function evidenceStrengthFor(kind: EvidenceKind): EvidenceStrength {
  return STRENGTH_BY_KIND[kind];
}

export function getReviewGateLevel(): ReviewGateLevel {
  const raw = String(process.env.REVIEW_GATE_LEVEL || '1').trim();
  if (raw === '0') return 0;
  if (raw === '2') return 2;
  return 1;
}

/**
 * Collapse currency / thousand-separator / slug spellings so `$64,000`,
 * `64000`, and a URL slug `usd64-000` all compare equal.
 */
export function normalizeFactBlob(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/[￥$€£¥]/g, '')
    .replace(/\b(?:usd|usdt|cny|rmb)\b/g, '')
    .replace(/(\d)[,_\s.](?=\d{3}(?:\D|$))/g, '$1')
    .replace(/(\d)-(?=\d{3}(?:\D|$))/g, '$1')
    .replace(/\s+/g, ' ');
}

/** Does this fact token appear in the given haystack (currency-insensitive)? */
export function factAppearsIn(token: string, haystack: string): boolean {
  const raw = String(token || '').toLowerCase();
  if (!raw) return true;
  const hay = String(haystack || '').toLowerCase();
  if (!hay) return false;
  if (hay.includes(raw)) return true;
  if (hay.includes(raw.replace(/,/g, ''))) return true;
  const norm = normalizeFactBlob(raw);
  return Boolean(norm && normalizeFactBlob(hay).includes(norm));
}

export type EvidenceIndex = {
  units: EvidenceUnit[];
  /** Units grouped by normalized URL key (caller supplies normalizeUrl). */
  byUrl: Map<string, EvidenceUnit[]>;
};

/** Strongest evidence available for a URL — decides how hard we may judge a claim. */
export function strongestFor(index: EvidenceIndex, urlKey: string): EvidenceUnit | null {
  const units = index.byUrl.get(urlKey) || [];
  if (!units.length) return null;
  return units.reduce((best, u) =>
    STRENGTH_RANK[u.strength] > STRENGTH_RANK[best.strength] ? u : best,
  );
}

/** Combined haystack across every unit for a URL. */
export function haystackFor(index: EvidenceIndex, urlKey: string): string {
  return (index.byUrl.get(urlKey) || []).map((u) => u.text).join('\n');
}

export function buildEvidenceIndex(
  units: EvidenceUnit[],
  normalizeUrl: (url: string) => string,
): EvidenceIndex {
  const byUrl = new Map<string, EvidenceUnit[]>();
  for (const unit of units) {
    if (!unit.url) continue;
    const key = normalizeUrl(unit.url);
    if (!key) continue;
    const list = byUrl.get(key) || [];
    list.push(unit);
    byUrl.set(key, list);
  }
  return { units, byUrl };
}

/** Classify + trim a raw text field into an evidence unit payload. */
export function makeEvidenceUnit(input: {
  index: number;
  url: string;
  title?: string;
  text: string;
  kind: EvidenceKind;
  tool: string;
}): EvidenceUnit {
  const cap =
    input.kind === 'body'
      ? MAX_BODY_CHARS
      : input.kind === 'payload'
        ? MAX_PAYLOAD_CHARS
        : MAX_BLURB_CHARS;
  const text = [input.title, input.text].filter(Boolean).join('\n').slice(0, cap);
  return {
    id: `ev-${input.index}`,
    url: input.url,
    title: input.title,
    text,
    kind: input.kind,
    strength: evidenceStrengthFor(input.kind),
    tool: input.tool,
  };
}

/** Human-readable evidence citation for a finding (OpenScience: no evidence = opinion). */
export function citeEvidence(unit: EvidenceUnit | null): string {
  if (!unit) return 'no retrieval evidence for this URL';
  const scope =
    unit.kind === 'body'
      ? 'full page text'
      : unit.kind === 'blurb'
        ? 'search title/snippet only'
        : 'tool payload';
  return `${unit.id} (${unit.tool}, ${scope}, ${unit.strength})`;
}

/**
 * Map a fact-check outcome + evidence strength → Foundry-style verdict and
 * OpenScience-style severity grade.
 */
export function gradeClaimGap(input: {
  missing: string[];
  strength: EvidenceStrength;
  /** True when evidence text contains a conflicting numeric for the same claim window. */
  contradicted?: boolean;
}): { verdict: ClaimVerdict; grade: ReviewSeverityGrade; uiSeverity: 'error' | 'warn' } {
  if (input.contradicted) {
    return { verdict: 'contradicted', grade: 'blocking', uiSeverity: 'error' };
  }
  if (!input.missing.length) {
    return { verdict: 'confirmed', grade: 'info', uiSeverity: 'warn' };
  }
  if (input.strength === 'strong') {
    return { verdict: 'unsupported', grade: 'major', uiSeverity: 'error' };
  }
  if (input.strength === 'moderate') {
    return { verdict: 'partially_supported', grade: 'minor', uiSeverity: 'warn' };
  }
  // Weak blurbs: absence ≠ falsehood.
  return { verdict: 'unverifiable', grade: 'minor', uiSeverity: 'warn' };
}

function trimUrlTail(raw: string): string {
  return String(raw || '').replace(/[.,;:!?)\]}'"”』」]+$/, '');
}

function looksLikeWebReadTool(tool: string): boolean {
  return /web_read|web-read|read_url|fetch_url/i.test(tool);
}

function looksLikeSearchTool(tool: string): boolean {
  return /search|proactive_search/i.test(tool);
}

/**
 * Extract evidence units from a single tool payload.
 * Prefer structured JSON (web_read content → body; search hits → blurb).
 */
export function extractEvidenceFromPayload(
  tool: string,
  payload: string,
  startIndex = 0,
): EvidenceUnit[] {
  const units: EvidenceUnit[] = [];
  let next = startIndex;
  const push = (raw: {
    url?: unknown;
    title?: unknown;
    text?: unknown;
    kind: EvidenceKind;
  }) => {
    const url = trimUrlTail(String(raw.url || ''));
    if (!/^https?:\/\//i.test(url)) return;
    const text = String(raw.text || '').trim();
    if (!text && !raw.title) return;
    units.push(
      makeEvidenceUnit({
        index: next++,
        url,
        title: String(raw.title || '').trim().slice(0, 200) || undefined,
        text: text || String(raw.title || ''),
        kind: raw.kind,
        tool: tool || 'unknown',
      }),
    );
  };

  try {
    const parsed = JSON.parse(payload) as unknown;
    // web_read shape: { url, title, content }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const content = String(obj.content || obj.text || obj.body || '').trim();
      const url = obj.url || obj.link || obj.href;
      if (url && content && (looksLikeWebReadTool(tool) || content.length > 600)) {
        push({
          url,
          title: obj.title || obj.name,
          text: content,
          kind: looksLikeWebReadTool(tool) || content.length > 600 ? 'body' : 'payload',
        });
      }
    }

    const walk = (node: unknown, depth = 0) => {
      if (depth > 6 || units.length >= 40 || node == null) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      if (typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (obj.url || obj.link || obj.href) {
        const blurb = String(
          obj.snippet || obj.description || obj.summary || '',
        ).trim();
        const body = String(obj.content || obj.text || obj.body || '').trim();
        // Prefer body when this looks like a full extract; else blurb.
        if (body.length > 600 || (looksLikeWebReadTool(tool) && body)) {
          push({
            url: obj.url || obj.link || obj.href,
            title: obj.title || obj.name,
            text: body,
            kind: 'body',
          });
        } else if (blurb || obj.title) {
          push({
            url: obj.url || obj.link || obj.href,
            title: obj.title || obj.name,
            text: blurb || String(obj.title || ''),
            kind: looksLikeSearchTool(tool) ? 'blurb' : 'payload',
          });
        }
      }
      for (const v of Object.values(obj)) walk(v, depth + 1);
    };
    walk(parsed);
  } catch {
    // non-JSON: scrape URLs + treat surrounding text as weak/moderate payload
    const text = String(payload || '');
    for (const match of text.matchAll(URL_RE)) {
      const url = trimUrlTail(match[0]);
      if (!/^https?:\/\//i.test(url)) continue;
      const idx = match.index ?? 0;
      const window = text.slice(Math.max(0, idx - 80), Math.min(text.length, idx + 400));
      push({
        url,
        text: window,
        kind: looksLikeWebReadTool(tool) ? 'body' : 'payload',
      });
      if (units.length >= 24) break;
    }
  }

  // Deduplicate by url+kind, keep longest text.
  const best = new Map<string, EvidenceUnit>();
  for (const u of units) {
    const key = `${u.url}|${u.kind}`;
    const prev = best.get(key);
    if (!prev || u.text.length > prev.text.length) best.set(key, u);
  }
  return [...best.values()];
}

/**
 * Merge evidence units already attached to execution-record entries.
 * Callers that only have sources (no evidence[]) should build units separately.
 */
export function collectEvidenceUnits(
  entries: Array<{ tool?: string; evidence?: EvidenceUnit[]; sources?: Array<{ url: string; title?: string; snippet?: string }> }>,
): EvidenceUnit[] {
  const out: EvidenceUnit[] = [];
  let n = 0;
  for (const entry of entries) {
    if (entry.evidence?.length) {
      for (const u of entry.evidence) {
        out.push({ ...u, id: `ev-${n++}` });
      }
      continue;
    }
    // Fallback: promote short UI sources to weak blurbs.
    for (const s of entry.sources || []) {
      if (!s.url) continue;
      out.push(
        makeEvidenceUnit({
          index: n++,
          url: s.url,
          title: s.title,
          text: s.snippet || s.title || '',
          kind: 'blurb',
          tool: entry.tool || 'unknown',
        }),
      );
    }
  }
  return out;
}
