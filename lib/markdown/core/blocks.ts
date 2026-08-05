/**
 * Restore block-level Markdown when models (esp. GLM / Gemma) collapse newlines
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
  // Mid-line only (Gemma/GLM after Latin/code): `选 intel ### 第二步`.
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

/** Full structural repair: headings / lists / hrs, then GFM table repair. */
export function reflowCollapsedMarkdownBlocks(markdown: string): string {
  const src = String(markdown || '');
  if (!src) return src;

  // Tables first: while a smashed table is still one line, the prose-level rules
  // below (`| … | **next**` → new block) cannot tell a row boundary from a
  // table→prose boundary and would tear the last cell out of its row.
  let out = reflowOutsideFences(src, reflowCollapsedMarkdownTables);
  out = reflowOutsideFences(out, reflowHeadingsListsHrs);
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}
