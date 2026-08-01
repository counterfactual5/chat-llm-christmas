import {
  buildEvidenceIndex,
  citeEvidence,
  collectEvidenceUnits,
  factAppearsIn,
  gradeClaimGap,
  haystackFor,
  strongestFor,
  type EvidenceStrength,
} from '@/lib/tools/review/core/evidence';
import type { CitationAnchor, CitationAudit, ExecutionRecordEntry, ReviewCheck, ReviewCheckItem } from '@/lib/tools/review/core/types';
import {
  clauseAfter,
  clauseBefore,
  collectSources,
  hasRetrievalReceipt,
  hostOf,
  NON_CITATION_HOST_RE,
  normalizeUrl,
  stripCodeBlocks,
  trimUrlTail,
} from '@/lib/tools/review/core/shared';

const URL_RE = /https?:\/\/[^\s"'\`<>()\[\]{}\\|]+/gi;

/** Numbers / years / percentages that a citation should be able to back. */
function extractFactualTokens(text: string): string[] {
  const tokens = new Set<string>();
  const src = String(text || '');
  for (const m of src.matchAll(
    /\b(?:19|20)\d{2}\b|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?\s?(?:万|亿|亿人|万人|USD|CNY|美元|元|亿欧元)\b|\b\d{4,}\b/g,
  )) {
    tokens.add(m[0].replace(/\s+/g, ''));
  }
  return [...tokens].slice(0, 12);
}

/** Title + snippet + URL slug — never the full article (unless web_read stored it). */
function sourceText(source: { url: string; title?: string; snippet?: string }): string {
  let pathPart = '';
  try {
    pathPart = decodeURIComponent(new URL(source.url).pathname || '');
  } catch {
    pathPart = source.url || '';
  }
  return [source.title, source.snippet, pathPart].filter(Boolean).join(' ');
}

export function extractCitationAnchors(assistantText: string): CitationAnchor[] {
  const text = stripCodeBlocks(assistantText);
  if (!text.trim()) return [];

  const anchors: CitationAnchor[] = [];
  const seen = new Set<string>();
  // Image targets are not citations, but must still be excluded from bare-URL pickup.
  const covered = new Set<string>();

  const push = (url: string, claim: string) => {
    const host = hostOf(url);
    if (!host || NON_CITATION_HOST_RE.test(host)) return;
    const key = `${normalizeUrl(url)}|${claim.slice(0, 80)}`;
    if (seen.has(key)) return;
    seen.add(key);
    anchors.push({ url: trimUrlTail(url), claim: claim.replace(/\s+/g, ' ').trim().slice(0, 280) });
  };

  // Markdown links: [label](url) — claim = surrounding clause (before + after) + label.
  // Skip `![alt](url)` images (the `!` sits immediately before `[`).
  const mdLinkRe = /\[([^\]]{1,120})\]\((https?:\/\/[^)\s]+)\)/g;
  for (const match of text.matchAll(mdLinkRe)) {
    const label = match[1].trim();
    const url = match[2];
    const idx = match.index ?? 0;
    if (idx > 0 && text[idx - 1] === '!') {
      covered.add(normalizeUrl(url));
      continue;
    }
    const end = idx + match[0].length;
    const claim = [clauseBefore(text, idx), label, clauseAfter(text, end)]
      .filter(Boolean)
      .join(' — ');
    push(url, claim || label || url);
    covered.add(normalizeUrl(url));
  }

  // Bare URLs not already covered as markdown link/image targets.
  for (const a of anchors) covered.add(normalizeUrl(a.url));
  for (const match of text.matchAll(URL_RE)) {
    const url = trimUrlTail(match[0]);
    if (covered.has(normalizeUrl(url))) continue;
    const idx = match.index ?? 0;
    const end = idx + match[0].length;
    const claim = [clauseBefore(text, idx, 180), clauseAfter(text, end, 40)]
      .filter(Boolean)
      .join(' — ');
    push(url, claim || url);
  }

  return anchors.slice(0, 24);
}

export function formatReviewClaimTitle(claim: string, max = 140): string {
  const cleaned = String(claim || '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (cleaned.length <= max) return cleaned;
  const slice = cleaned.slice(0, max);
  const cut = Math.max(
    slice.lastIndexOf('，'),
    slice.lastIndexOf('。'),
    slice.lastIndexOf('、'),
    slice.lastIndexOf(' '),
    slice.lastIndexOf(','),
    slice.lastIndexOf('—'),
  );
  return `${(cut > max * 0.45 ? slice.slice(0, cut) : slice).trim()}…`;
}

export function auditCitations(
  assistantText: string,
  record: ExecutionRecordEntry[],
): CitationAudit | null {
  if (!hasRetrievalReceipt(record)) return null;
  const sources = collectSources(record);
  if (!sources.length) return null;

  const units = collectEvidenceUnits(record);
  const index = buildEvidenceIndex(units.length ? units : collectEvidenceUnits(
    sources.map((s) => ({ sources: [s], tool: 'unknown' })),
  ), normalizeUrl);

  const byUrl = new Map(sources.map((s) => [normalizeUrl(s.url), s]));
  const anchors = extractCitationAnchors(assistantText);
  if (!anchors.length) return null;

  const unsupported: string[] = [];
  const unsupportedClaims: CitationAudit['unsupportedClaims'] = [];
  const seenUnsupported = new Set<string>();
  let matched = 0;

  for (const anchor of anchors) {
    const key = normalizeUrl(anchor.url);
    const source = byUrl.get(key);
    if (!source) {
      if (!seenUnsupported.has(key)) {
        seenUnsupported.add(key);
        unsupported.push(anchor.url);
      }
      continue;
    }
    matched++;

    const best = strongestFor(index, key);
    const hay = haystackFor(index, key) || sourceText(source);
    if (!hay.trim()) continue; // URL-only receipt — can't verify content yet.

    const facts = extractFactualTokens(anchor.claim);
    if (facts.length < 1) continue;
    const missing = facts.filter((t) => !factAppearsIn(t, hay));
    if (!missing.length) continue;

    // Blurbs are partial — only flag distinctive figures (%, decimals, large nums).
    // Bare years (2026) almost never appear in a short search blurb even when the
    // article is about that year — only treat them as notable against full-page body.
    const strength: EvidenceStrength = best?.strength || 'weak';
    const notable = missing.filter((t) => {
      if (/^(?:19|20)\d{2}$/.test(String(t))) return strength === 'strong';
      if (/%/.test(t) || /\.\d/.test(t) || /,/.test(t)) return true;
      const n = Number(String(t).replace(/[^\d.]/g, ''));
      return Number.isFinite(n) && (n >= 100 || String(t).length >= 4);
    });
    if (!notable.length) continue;

    const graded = gradeClaimGap({ missing: notable, strength });
    // Confirmed shouldn't appear here; skip info-only.
    if (graded.verdict === 'confirmed') continue;

    unsupportedClaims.push({
      url: anchor.url,
      claim: anchor.claim,
      missing: notable.slice(0, 4),
      verdict: graded.verdict,
      strength,
      evidenceId: best?.id,
    });
  }

  return {
    checked: anchors.length,
    matched,
    unsupported,
    unsupportedClaims: unsupportedClaims.slice(0, 8),
  };
}

export function buildCitationCheck(
  assistantText: string,
  record: ExecutionRecordEntry[],
): ReviewCheck | null {
  const audit = auditCitations(assistantText, record);
  if (!audit) return null;

  const index = buildEvidenceIndex(collectEvidenceUnits(record), normalizeUrl);
  const items: ReviewCheckItem[] = [];
  for (const url of audit.unsupported.slice(0, 8)) {
    items.push({
      severity: 'warn',
      title: `Link not in tool results: ${url}`,
      detail:
        'This URL never appeared in any retrieval payload — unverifiable (no evidence unit). Verify it or remove it.',
    });
  }
  for (const row of audit.unsupportedClaims.slice(0, 8)) {
    const best = strongestFor(index, normalizeUrl(row.url));
    const evidenceNote = citeEvidence(best);
    const isStrong = row.verdict === 'unsupported' || row.verdict === 'contradicted';
    items.push({
      severity: isStrong ? 'error' : 'warn',
      title: formatReviewClaimTitle(row.claim) || row.url,
      detail: isStrong
        ? `[${row.verdict}/${row.strength}] Cited ${row.url}, but full-page evidence does not contain: ${row.missing.join(', ')}. Evidence: ${evidenceNote}.`
        : `[${row.verdict}/${row.strength}] Cited ${row.url}; available evidence (${evidenceNote}) does not contain: ${row.missing.join(', ')}. Absence from a search blurb is not proof the article is wrong — treat as unverified.`,
    });
  }

  const bits = [`${audit.matched}/${audit.checked} links in receipts`];
  const strongN = audit.unsupportedClaims.filter(
    (c) => c.verdict === 'unsupported' || c.verdict === 'contradicted',
  ).length;
  const weakN = audit.unsupportedClaims.length - strongN;
  if (strongN) bits.push(`${strongN} unsupported vs page body`);
  if (weakN) bits.push(`${weakN} unverifiable vs blurb`);

  return {
    id: 'citation',
    kind: 'citation',
    status: 'done',
    clean: items.length === 0,
    summary:
      items.length === 0
        ? `Verified ${bits[0]}`
        : `${items.length} citation issue(s) · ${bits.join(' · ')}`,
    items,
  };
}
