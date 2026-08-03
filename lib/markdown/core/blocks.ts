/**
 * Restore block-level Markdown when models (esp. GLM) collapse newlines into
 * spaces. Without line starts, remark leaves `##`, `-`, `---`, and tables as
 * literal text inside one giant paragraph.
 */

import { reflowCollapsedMarkdownTables } from '@/lib/markdown/core/tables';

const FENCE_SPLIT = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;

/**
 * End-of-prose markers before a new block.
 * Deliberately excludes A-Za-z0-9 — Latin letters as break points shred English
 * Thought/CoT (`Daddy. 3.` is fine via `.`, but `e - list` is not).
 * Use a normal template so `\u4e00-\u9fff` is a real CJK range (String.raw would not).
 */
const BREAK_BEFORE = `。，、！？；：…\u4e00-\u9fff)）\\]】」》"'\u201c\u201d\u2018\u2019`;

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
  // After a Latin token when the item itself starts with CJK (`Telegram 2. 加入`)
  out = out.replace(/([A-Za-z0-9])\s+(\d{1,2}\.\s+[\u4e00-\u9fff])/g, '$1\n$2');

  // URL then another field bullet: `https://eleduck.com - 特点：…`
  out = out.replace(
    /(https?:\/\/\S+)\s+(-\s+(?:状态|网址|特点|链接|注意|路径)[:：])/g,
    '$1\n$2',
  );

  // CTA after list prose: `建立人脉 需要我帮你：`
  out = out.replace(/([^\n])\s+(需要我(?:帮你|协助)[:：])/g, '$1\n\n$2');

  // Closed emphasis then a heading / ordered list. Do NOT break before `- ` —
  // command catalogs use `**/image** - 生成图片` on one line; inserting a
  // newline turns the description into its own bullet.
  out = out.replace(
    /(\*\*)\s+(?=(?:#{1,6}\s|\d{1,2}\.\s+\S))/g,
    '$1\n\n',
  );

  // Table row ended, prose resumes — ONLY when the next token is clearly a new
  // block (`**`, heading, list). A bare `(?=[^|])` falsely splits the last
  // cell (`| 已售 | 已被 GoDaddy 挂售 |` → breaks before `已被`).
  out = out.replace(
    /((?:\|[^|\n]*){2,}\|)\s+(?=(?:\*\*|#{1,6}\s|-\s+\S|\d{1,2}\.\s+\S))/g,
    '$1\n\n',
  );

  return out;
}

/**
 * Full structural repair: headings / lists / hrs, then GFM table repair
 * (title peel + smashed rows). Table/prose splits belong in tables.ts so we
 * do not shred real data rows that start with CJK (`中文版 | ⚠️ | …`).
 */
export function reflowCollapsedMarkdownBlocks(markdown: string): string {
  const src = String(markdown || '');
  if (!src) return src;

  let out = reflowOutsideFences(src, reflowHeadingsListsHrs);
  out = reflowCollapsedMarkdownTables(out);
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}
