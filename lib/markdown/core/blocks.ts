/**
 * Restore block-level Markdown when models (esp. GLM) collapse newlines into
 * spaces. Without line starts, remark leaves `##`, `-`, `---`, and tables as
 * literal text inside one giant paragraph.
 */

import { reflowCollapsedMarkdownTables } from '@/lib/markdown/core/tables';

const FENCE_SPLIT = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;

/**
 * Characters that usually end a prose run before a new block.
 * Include CJK punctuation so `了，##` / `台 |` still break.
 */
const BREAK_BEFORE =
  String.raw`。，、！？；：…\u4e00-\u9fffA-Za-z0-9\)）\]】」》"'”’`;

function reflowOutsideFences(
  markdown: string,
  transform: (chunk: string) => string,
): string {
  const parts = String(markdown || '').split(FENCE_SPLIT);
  return parts
    .map((part, i) => {
      // Odd indices are fence matches when the split pattern has a capturing group.
      if (i % 2 === 1) return part;
      return transform(part);
    })
    .join('');
}

function reflowHeadingsListsHrs(chunk: string): string {
  let out = chunk;

  // `…文案 ## 标题` / `… ### 1. …`
  out = out.replace(
    new RegExp(String.raw`([${BREAK_BEFORE}])\s+(#{1,6}\s+\S)`, 'g'),
    '$1\n\n$2',
  );
  out = out.replace(/([.!?])\s+(#{1,6}\s+\S)/g, '$1\n\n$2');

  // Thematic breaks jammed into prose. Blank line BEFORE `---` is required so
  // CommonMark does not treat it as a setext underline for the prior paragraph.
  out = out.replace(
    new RegExp(String.raw`([${BREAK_BEFORE}.!?])\s+(---+)(?=\s|#{1,6}\s|$)`, 'g'),
    '$1\n\n$2',
  );
  out = out.replace(/(---+)\s+(?=#{1,6}\s)/g, '$1\n\n');

  // Table starts after prose: `关停的平台 | 平台 | 状态 |`
  out = out.replace(
    new RegExp(String.raw`([${BREAK_BEFORE}.!?])\s+(\|(?:[^|\n]+\|){2,})`, 'g'),
    '$1\n\n$2',
  );

  // Unordered lists: `运营 - 状态：` / `） - 网址`
  out = out.replace(
    new RegExp(String.raw`([${BREAK_BEFORE}])\s+(-\s+\S)`, 'g'),
    '$1\n$2',
  );

  // Ordered lists: `推荐） 1. 电鸭` / `。 2. 同时`
  out = out.replace(
    new RegExp(String.raw`([${BREAK_BEFORE}.!?])\s+(\d{1,2}\.\s+\S)`, 'g'),
    '$1\n$2',
  );

  // Closed emphasis then a new block: `**建议** ##` / `**了。** 1. 加入`
  out = out.replace(
    /(\*\*)\s+(?=(?:#{1,6}\s|-\s+\S|\d{1,2}\.\s+\S))/g,
    '$1\n\n',
  );

  // Table row ended, prose resumes: `| 挂售 | **我的建议**` (not `| |` row gap)
  out = out.replace(/((?:\|[^|\n]*){2,}\|)\s+(?=[^|\s\n])/g, '$1\n\n');

  return out;
}

/**
 * Full structural repair: headings / lists / hrs / table lead-in, then smashed tables.
 */
export function reflowCollapsedMarkdownBlocks(markdown: string): string {
  const src = String(markdown || '');
  if (!src) return src;

  let out = reflowOutsideFences(src, reflowHeadingsListsHrs);
  out = reflowCollapsedMarkdownTables(out);
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}
