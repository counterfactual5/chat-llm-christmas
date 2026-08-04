import type { ReviewCheck, ReviewCheckItem } from '@/lib/tools/review/core/types';
import { splitTableRow, stripCodeBlocks } from '@/lib/tools/review/core/shared';

const GENERIC_LABEL_RE =
  /^(?:值|数值|数量|内容|示例|例如|如下|结果|说明|备注|其中|比如|note|value|example|result|total)$/i;

/**
 * Trailing hedge words carry no metric identity: “实际约为 15%” is about SOME
 * metric named earlier, not a metric called 实际约. Strip them so the real
 * subject (有效税率实际约 → 有效税率) becomes the key; a bare hedge with no
 * subject is dropped entirely — it cannot be tracked as a metric.
 */
const TRAILING_HEDGE_RE =
  /(?:\s|实际约|约为|大约|大概|将近|约等于|实际|接近|近|约|approx(?:imately)?|roughly|around|about|nearly|near|circa)+$/i;

/**
 * Leading connectives glued onto CJK labels (因此毛利率为…) would split one
 * metric into several keys and hide real contradictions — peel them off.
 */
const LEADING_CONNECTIVE_RE =
  /^(?:因此|所以|但是|不过|然而|但|而|则|即|故|因为|由于|同时|另外|此外|最终|最后|综上|合计|总计|其中|目前|现在|经计算|经过计算|计算后|得出|得到|可见|说明|表明|意味着)+/;

const LABELED_NUMBER_RE =
  /([\p{L}\p{N}][\p{L}\p{N}_ ·%（）()-]{1,22})\s*(?:[:：]|是|为)\s*([-−]?\d[\d,._]*(?:\.\d+)?)\s*([%％]|万|亿|个|人|元|美元|天|小时|分钟|次|倍)?/gu;

function normalizeLabel(raw: string): string {
  return raw
    .replace(/[*_`#>]/g, '')
    .replace(/^[\s,.、，。;；:：-]+|[\s,.、，。;；:：-]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

type ConsistencyHit = {
  value: string;
  index: number;
  /** Other numeric tokens on the hit's line — row keys like $12k / $18k. */
  discriminators: Set<string>;
  /** First cell when the hit sits in a markdown table row. */
  rowKey: string;
};

function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  let end = text.indexOf('\n', index);
  if (end < 0) end = text.length;
  return text.slice(start, end);
}

function numbersInLine(line: string): string[] {
  return [...line.matchAll(/[-−]?\d[\d.,_]*/g)].map((m) =>
    m[0].replace(/[,_]/g, '').replace(/[−]/g, '-'),
  );
}

/**
 * Two same-label hits with different values are still fine when their lines are
 * distinguished by other data — different table-row keys, different list items,
 * or different companion numbers mean “enumeration over cases” (income brackets,
 * product tiers, search result rows), not a contradiction. Only symmetric
 * distinguishing evidence counts: each side must have a token the other lacks.
 */
function hitsDistinguishable(a: ConsistencyHit, b: ConsistencyHit): boolean {
  if (a.rowKey && b.rowKey && a.rowKey !== b.rowKey) return true;
  // The two compared values themselves are not context — when both hits share a
  // paragraph, each other's value would otherwise fake a distinguishing token.
  const ignore = new Set([a.value, b.value]);
  const aOnly = [...a.discriminators].some(
    (t) => !ignore.has(t) && !b.discriminators.has(t),
  );
  const bOnly = [...b.discriminators].some(
    (t) => !ignore.has(t) && !a.discriminators.has(t),
  );
  return aOnly && bOnly;
}

/** Treat numbered/bulleted list items like table rows for enumeration context. */
function listItemKey(text: string, index: number): string {
  const before = text.slice(0, Math.max(0, index));
  // Horizontal whitespace only — `\s*` would swallow the blank line before `1.`
  // and make lineStart land on `\n`, yielding an empty key.
  let marker = [...before.matchAll(/^[^\S\n]*\d+\.[^\S\n]+/gm)].at(-1);
  if (!marker) {
    marker = [...before.matchAll(/^[^\S\n]*[-*+][^\S\n]+/gm)].at(-1);
  }
  if (!marker || marker.index == null) return '';
  const lineStart = marker.index;
  let lineEnd = text.indexOf('\n', lineStart);
  if (lineEnd < 0) lineEnd = text.length;
  return normalizeLabel(text.slice(lineStart, lineEnd)).slice(0, 96);
}

export function buildConsistencyCheck(assistantText: string): ReviewCheck | null {
  const text = stripCodeBlocks(assistantText);
  if (text.trim().length < 120) return null;

  const byKey = new Map<string, ConsistencyHit[]>();

  for (const match of text.matchAll(LABELED_NUMBER_RE)) {
    const label = normalizeLabel(match[1])
      .replace(LEADING_CONNECTIVE_RE, '')
      .replace(TRAILING_HEDGE_RE, '');
    if (label.length < 2 || GENERIC_LABEL_RE.test(label)) continue;
    const unit = match[3] || '';
    const value = match[2].replace(/[,_\s]/g, '').replace(/[−]/g, '-');
    const index = match.index ?? 0;
    const line = lineAt(text, index);
    const discriminators = new Set(numbersInLine(line).filter((v) => v !== value));
    const tableKey = line.includes('|') ? splitTableRow(line)[0] || '' : '';
    const rowKey = tableKey || listItemKey(text, index);
    const key = `${label}|${unit}`;
    const list = byKey.get(key) || [];
    list.push({ value, index, discriminators, rowKey });
    byKey.set(key, list);
  }

  const items: ReviewCheckItem[] = [];
  for (const [key, hits] of byKey) {
    if (hits.length < 2 || items.length >= 6) continue;
    const distinct = [...new Set(hits.map((h) => h.value))];
    if (distinct.length < 2) continue;
    // Adjacent mentions are usually an enumeration of variants, not a contradiction.
    const spread = Math.max(...hits.map((h) => h.index)) - Math.min(...hits.map((h) => h.index));
    if (spread < 200) continue;
    // A conflict needs at least one pair of differing values whose contexts are
    // NOT otherwise distinguished (same row key, same companion numbers).
    let conflicting: [ConsistencyHit, ConsistencyHit] | null = null;
    outer: for (let i = 0; i < hits.length; i++) {
      for (let j = i + 1; j < hits.length; j++) {
        if (hits[i].value === hits[j].value) continue;
        if (!hitsDistinguishable(hits[i], hits[j])) {
          conflicting = [hits[i], hits[j]];
          break outer;
        }
      }
    }
    if (!conflicting) continue;
    const [label, unit] = key.split('|');
    items.push({
      severity: 'warn',
      title: `"${label}" stated as ${conflicting.map((h) => h.value).join(' vs ')}${unit ? ` ${unit}` : ''}`,
      detail: 'The same metric carries different values in different parts of the answer, with no distinguishing context (different table rows, list items, or companion figures would exempt it).',
    });
  }

  const tracked = [...byKey.values()].filter((h) => h.length >= 2).length;
  if (!items.length && !tracked) return null;

  return {
    id: 'consistency',
    kind: 'consistency',
    status: 'done',
    clean: items.length === 0,
    summary: items.length
      ? `${items.length} internal contradiction(s)`
      : `${tracked} repeated metric(s) agree`,
    items,
  };
}
