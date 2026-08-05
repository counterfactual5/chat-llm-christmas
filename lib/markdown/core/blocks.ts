/**
 * Restore block-level Markdown when models (esp. GLM / Step) collapse newlines
 * into spaces. Without line starts, remark leaves `##`, `-`, `---`, and tables
 * as literal text inside one giant paragraph.
 *
 * Rules stay narrow on purpose: a broad “any CJK + `- ` / `1. `” break turns
 * normal prose (`价格 - 约一百`, `见图 1. 架构`) into fake lists. Mid-line
 * `###` / `---` splits only fire when the marker is not already at line start,
 * so correct Markdown is a no-op.
 */

import { reflowCollapsedMarkdownTables } from '@/lib/markdown/core/tables';

const FENCE_SPLIT = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;

/**
 * Sentence / closing markers for list/HR breaks — NOT the full CJK range.
 * Keep ASCII `]` out of interpolated classes (it would terminate `[...]` early).
 */
const BREAK_HARD = `。！？；：.!?)）】」》"'”’“”‘’`;

/** CJK + hard breaks — safe to embed inside `[...]`. */
const BREAK_TEXT = `\u4e00-\u9fff${BREAK_HARD}`;

/**
 * Unordered markers we are willing to re-break onto their own line after prose.
 * Field labels cover GLM “- 状态：” cards; `/cmd` and `**` cover catalogs.
 */
const UL_ITEM =
  String.raw`-\s+(?:(?:状态|网址|特点|链接|注意|路径|直接)[:：]|/[A-Za-z*]|\*\*)`;

/** Likely a new Markdown block — never glue the previous line onto it. */
function isMarkdownBlockStart(line: string): boolean {
  const t = String(line || '').trimStart();
  if (!t) return true;
  if (/^(#{1,6}\s|```|~~~|>\s|-\s+|\*\s+(?!\*)|_\s+(?!_)|\d{1,2}\.\s+)/.test(t)) {
    return true;
  }
  if (/^-{3,}\s*$/.test(t)) return true;
  // Table row or separator.
  if (/^\|/.test(t) && t.includes('|', 1)) return true;
  return false;
}

/**
 * Step / some chat models hard-wrap around ~40 cols, often mid-CJK word
 * (`备选方\n案，` or `**备选方**\n案`). Join only those single-newline wraps —
 * blank lines and real block starts stay put (so short poem lines survive).
 */
function shouldJoinHardWrap(prev: string, next: string): boolean {
  if (!prev.trim() || !next.trim()) return false;
  if (isMarkdownBlockStart(next)) return false;
  if (/^\s*#{1,6}\s/.test(prev)) return false;
  // Keep table rows intact (neither glue two rows, nor glue a row into prose).
  if (/^\s*\|/.test(prev.trimStart()) && prev.includes('|', 1)) return false;
  if (/^\s*\|/.test(next.trimStart()) && next.includes('|', 1)) return false;

  const a = prev.trimEnd();
  const b = next.trimStart();
  const aLast = a.charAt(a.length - 1);
  const bFirst = b.charAt(0);
  const cjk = /[\u4e00-\u9fff]/;

  // Emphasis/code closed right before the wrap: `**备选方**\n案，`
  if (/[*`）)」』"'”’]$/.test(a) && cjk.test(bFirst)) return true;
  // Clear mid-word wrap: next CJK is immediately followed by clause punct.
  if (cjk.test(aLast) && /^[\u4e00-\u9fff][，、]/.test(b)) return true;
  // Long hard-wrapped prose line continuing with CJK/Latin.
  const prevLen = a.replace(/\s+/g, '').length;
  if (prevLen >= 36 && cjk.test(aLast) && (cjk.test(bFirst) || /[A-Za-z0-9]/.test(bFirst))) {
    return true;
  }
  if (prevLen >= 36 && /[A-Za-z0-9]$/.test(a) && cjk.test(bFirst)) return true;
  return false;
}

function joinHardWrap(prev: string, next: string): string {
  const a = prev.trimEnd();
  const b = next.trimStart();
  const needSpace = /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b);
  return needSpace ? `${a} ${b}` : `${a}${b}`;
}

function unwrapHardWrappedProse(chunk: string): string {
  const lines = String(chunk || '').split('\n');
  if (lines.length < 2) return chunk;
  const out: string[] = [lines[0]!];
  for (let i = 1; i < lines.length; i++) {
    const prev = out[out.length - 1]!;
    const next = lines[i]!;
    if (shouldJoinHardWrap(prev, next)) {
      out[out.length - 1] = joinHardWrap(prev, next);
    } else {
      out.push(next);
    }
  }
  return out.join('\n');
}

function reflowOutsideFences(
  markdown: string,
  transform: (chunk: string) => string,
): string {
  const parts = String(markdown || '').split(FENCE_SPLIT);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return transform(part);
    })
    .join('');
}

function reflowHeadingsListsHrs(chunk: string): string {
  let out = chunk;

  // Models sometimes emit “thematic break dashes” using dash-like characters
  // (em/en/minus/fullwidth) instead of ASCII hyphen. Normalize to `-` so
  // Markdown treats it as `---` HR.
  out = out.replace(/[—–−－]{3,}/g, '---');

  // Headings: allow CJK lead-in — `渠道 ### 1.` is common in smashed replies.
  out = out.replace(
    new RegExp(`([${BREAK_TEXT}])\\s+(#{1,6}\\s+\\S)`, 'g'),
    '$1\n\n$2',
  );
  out = out.replace(/([.!?])\s+(#{1,6}\s+\S)/g, '$1\n\n$2');
  // Mid-line only (Step/GLM after Latin/code): `选 intel ### 第二步`.
  // Already-correct `\n### ` is a no-op; skip `|` so table cells stay intact.
  out = out.replace(/([^\n#|])[ \t]+(#{1,6}[ \t]+\S)/g, '$1\n\n$2');

  // Thematic breaks jammed into prose. Blank line BEFORE `---` so CommonMark
  // does not treat it as a setext underline. The space between prose and `---`
  // is optional: models write both `场景。 ---` and `场景。---`.
  out = out.replace(
    new RegExp(`([${BREAK_TEXT}])\\s*(---+)(?=\\s|#{1,6}\\s|$)`, 'g'),
    '$1\n\n$2',
  );
  // Mid-line after Latin/code: `下 intel ---` / `即可。 --- 需要我…` leftover.
  // Exclude `|` / `-` so table rows and existing `---` lines stay put.
  out = out.replace(
    /([^\n|\-])[ \t]+(---+)(?=[ \t]|$|\n|#{1,6}\s)/g,
    '$1\n\n$2',
  );
  // Prose glued onto the same line after an HR: `--- 需要我帮你…`
  out = out.replace(/(^|\n)(---+)[ \t]+(?=\S)/g, '$1$2\n\n');
  out = out.replace(/(---+)\s+(?=#{1,6}\s)/g, '$1\n\n');
  // Trailing HR jammed onto a finished pipe row: `| … | ---`
  out = out.replace(/(\|[^\n]*\|)[ \t]+(---+)[ \t]*$/gm, '$1\n\n$2');

  // Unordered: only field labels / slash commands / bold-leading items —
  // never bare `汉字 - 散文`.
  out = out.replace(
    new RegExp(`([${BREAK_TEXT}])\\s+(${UL_ITEM})`, 'g'),
    '$1\n$2',
  );

  // Ordered: only after hard sentence/closing punct (not any CJK), so
  // `见图 1. 架构` / `版本 2. 文档` stay intact.
  out = out.replace(
    new RegExp(`([${BREAK_HARD}])\\s+(\\d{1,2}\\.\\s+\\S)`, 'g'),
    '$1\n$2',
  );
  // After Latin when the item starts with CJK (`Telegram 2. 加入`)
  out = out.replace(/([A-Za-z0-9])\s+(\d{1,2}\.\s+[\u4e00-\u9fff])/g, '$1\n$2');
  // Continue splitting `1. foo 2. bar` once an item already starts a line —
  // does not fire on mid-prose `图 1. …表 2.`.
  for (let i = 0; i < 8; i++) {
    const next = out.replace(
      /(^|\n)(\d{1,2}\.\s+[^\n]*?)\s+(\d{1,2}\.\s+\S)/g,
      '$1$2\n$3',
    );
    if (next === out) break;
    out = next;
  }

  // URL then another field bullet: `https://eleduck.com - 特点：…`
  // Stop the URL at CJK/fullwidth so glued `…com/搜索 - 特点：` does not ingest 搜索.
  out = out.replace(
    /(https?:\/\/[^\s\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+)\s+(-\s+(?:状态|网址|特点|链接|注意|路径)[:：])/g,
    '$1\n$2',
  );

  // CTA after list prose: `建立人脉 需要我帮你：`
  out = out.replace(/([^\n])\s+(需要我(?:帮你|协助)[:：])/g, '$1\n\n$2');

  // Colon then a real bullet: `支持有限： - Mac通常…` (not `价格：约一百`).
  out = out.replace(/([：:])[ \t]+(-\s+[\u4e00-\u9fffA-Za-z])/g, '$1\n$2');
  // Continue splitting sibling bullets once a line already starts with `- `,
  // but never catalog lines (`- **/image** - 说明`).
  for (let i = 0; i < 8; i++) {
    const next = out.replace(
      /(^|\n)(-\s+(?!\*\*)[^\n]*?)\s+(-\s+(?!\*\*)[\u4e00-\u9fffA-Za-z])/g,
      '$1$2\n$3',
    );
    if (next === out) break;
    out = next;
  }

  // Closed emphasis then a heading / ordered list. Do NOT break before `- `
  // (`**/image** - 生成图片` must stay one catalog line).
  out = out.replace(
    /(\*\*)\s+(?=(?:#{1,6}\s|\d{1,2}\.\s+\S))/g,
    '$1\n\n',
  );

  // Table row ended, prose resumes — only clear new-block tokens, and only when
  // what follows has no pipes left: `| a | **bold cell** |` is still one row,
  // not a row followed by a bold paragraph.
  out = out.replace(
    /((?:\|[^|\n]*){2,}\|)[ \t]+((?:\*\*|#{1,6}\s|-\s+|\d{1,2}\.\s+)[^\n]*)/g,
    (full, row: string, rest: string) =>
      rest.includes('|') ? full : `${row}\n\n${rest}`,
  );

  return out;
}

/** Full structural repair: unwrap hard-wraps, then tables, then headings/lists/hrs. */
export function reflowCollapsedMarkdownBlocks(markdown: string): string {
  const src = String(markdown || '');
  if (!src) return src;

  // Undo mid-word hard wraps before structural splits so titles/tables see
  // whole tokens (`方案`, not `方` + `案`).
  let out = reflowOutsideFences(src, unwrapHardWrappedProse);
  // Tables next: while a smashed table is still one line, the prose-level rules
  // below (`| … | **next**` → new block) cannot tell a row boundary from a
  // table→prose boundary and would tear the last cell out of its row.
  out = reflowOutsideFences(out, reflowCollapsedMarkdownTables);
  out = reflowOutsideFences(out, reflowHeadingsListsHrs);
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}
