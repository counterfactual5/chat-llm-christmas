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

/** Always-safe newline normalization (plain text keeps the same visual breaks). */
export function normalizeMarkdownLineEndings(markdown: string): string {
  return String(markdown || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u2028|\u2029/g, '\n');
}

const PIPE_LIKE_CHAR = /[\uFF5C\u2502\u2503\u2223\u4E28\u00A6\uFFE8|]/;
const PIPE_LIKE_ONLY = /[\uFF5C\u2502\u2503\u2223\u4E28\u00A6\uFFE8]/g;

function pipeLikeCount(line: string): number {
  return (String(line || '').match(new RegExp(PIPE_LIKE_CHAR.source, 'g')) || [])
    .length;
}

/**
 * True when a line already looks like a GFM row/separator — not prose
 * `选项 A │ 选项 B` (only two marks, not pipe-wrapped).
 */
export function looksLikeTableishPipeLine(line: string): boolean {
  const t = String(line || '').trim();
  const n = pipeLikeCount(t);
  if (n < 2) return false;
  // Separator: mostly pipes + dashes (any dash style).
  if (n >= 2 && /^[\s|｜│┃:\-—–−－─━═]+$/.test(t)) return true;
  // Real / fake pipe-wrapped row: `| a | b |` or `│ a │ b │`
  if (n >= 2 && /^[|｜│┃]/.test(t) && /[|｜│┃]$/.test(t)) return true;
  // Jammed title + header needs ≥3 pipes: `第二步：… | 情况 | 推荐 | 原因 |`
  if (n >= 3) return true;
  return false;
}

/**
 * Convert fullwidth / box-drawing pipes to `|` only on table-ish lines so
 * plain `A │ B` and Unicode box diagrams stay untouched.
 */
export function normalizePipeLookalikesInTableishLines(markdown: string): string {
  return String(markdown || '')
    .split('\n')
    .map((line) =>
      looksLikeTableishPipeLine(line) ? line.replace(PIPE_LIKE_ONLY, '|') : line,
    )
    .join('\n');
}

/** @deprecated use normalizeMarkdownLineEndings + normalizePipeLookalikesInTableishLines */
export function normalizeMarkdownLineEndingsAndPipes(markdown: string): string {
  return normalizePipeLookalikesInTableishLines(
    normalizeMarkdownLineEndings(markdown),
  );
}

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
  // Numbered Chinese steps with a delimiter — not bare `第二步去验证`.
  if (/^第[一二三四五六七八九十百\d]+步(?:[:：]|[\s　])/.test(t)) return true;
  // Table row or separator.
  if (/^\|/.test(t) && t.includes('|', 1)) return true;
  return false;
}

/**
 * Models sometimes hard-wrap mid-CJK word (`**备选方**\n案，`). Join only those
 * single-newline wraps — blank lines and real block starts stay put.
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
  const cjk = /[\u4e00-\u9fff]/;

  // `**备选方**\n案，` — closing * / ` then a short CJK remnant + clause punct.
  // Do NOT join `` `_intel` `` + `第二步` (下一行是新段落，不是词内折行).
  if (
    /[*`）)」』"'”’]$/.test(a) &&
    /^[\u4e00-\u9fff]{1,2}[，、]/.test(b)
  ) {
    return true;
  }
  // Clear mid-word wrap: CJK\nCJK+punct.
  if (cjk.test(aLast) && /^[\u4e00-\u9fff][，、]/.test(b)) return true;
  // Long hard-wrapped prose line continuing with CJK/Latin.
  const prevLen = a.replace(/\s+/g, '').length;
  if (
    prevLen >= 36 &&
    cjk.test(aLast) &&
    (cjk.test(b.charAt(0)) || /[A-Za-z0-9]/.test(b.charAt(0)))
  ) {
    return true;
  }
  if (prevLen >= 36 && /[A-Za-z0-9]$/.test(a) && cjk.test(b.charAt(0))) {
    return true;
  }
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

  // Headings: allow CJK lead-in — `渠道 ### 1.` is common in smashed replies.
  out = out.replace(
    new RegExp(`([${BREAK_TEXT}])\\s+(#{1,6}\\s+\\S)`, 'g'),
    '$1\n\n$2',
  );
  out = out.replace(/([.!?])\s+(#{1,6}\s+\S)/g, '$1\n\n$2');
  // Mid-line only (Step/GLM after Latin/code): `选 intel ### 第二步`.
  // Already-correct `\n### ` is a no-op; skip `|` so table cells stay intact.
  out = out.replace(/([^\n#|])[ \t]+(#{1,6}[ \t]+\S)/g, '$1\n\n$2');
  // After a closed pipe row, a heading/HR often stays glued when the whole
  // reply was newline-collapsed: `| 说明 | ### 方案` / `| 说明 | --- ## 标题`.
  // (Bare `|` before `#` is skipped above so interior cells stay intact.)
  out = out.replace(/(\|[^\n]*\|)[ \t]+(#{1,6}[ \t]+\S)/g, '$1\n\n$2');
  out = out.replace(
    /(\|[^\n]*\|)[ \t]+(---+)\s+(?=#{1,6}\s)/g,
    '$1\n\n$2\n\n',
  );

  // Thematic breaks: ASCII `---` or dash-lookalikes (em/en/minus/fullwidth),
  // but ONLY in HR position — never rewrite mid-prose `前后———中间`.
  const hrDashes = String.raw`(?:-{3,}|[—–−－]{3,})`;
  // Standalone HR line.
  out = out.replace(
    new RegExp(String.raw`(^|\n)[ \t]*(${hrDashes})[ \t]*(?=\n|$)`, 'g'),
    '$1---',
  );
  // Thematic breaks jammed into prose. Blank line BEFORE so CommonMark
  // does not treat it as a setext underline. Space optional: `场景。 ---`
  // and `场景。———` / `场景。---`.
  out = out.replace(
    new RegExp(
      `([${BREAK_TEXT}])\\s*(${hrDashes})(?=\\s|#{1,6}\\s|$)`,
      'g',
    ),
    '$1\n\n---',
  );
  // After Latin/code only at line-end / before a heading — NOT `A --- not B`
  // (English em-dash prose must stay intact).
  out = out.replace(
    new RegExp(
      String.raw`([A-Za-z0-9\`*_）)」』])[ \t]+(${hrDashes})(?=[ \t]*$|\n|#{1,6}\s)`,
      'gm',
    ),
    '$1\n\n---',
  );
  // Prose glued onto the same line after an HR: `--- 需要我帮你…`
  // Do NOT fire on GFM separators without leading pipes: `--- | --- | ---`.
  out = out.replace(
    new RegExp(String.raw`(^|\n)(${hrDashes})[ \t]+(?![|:\-])(?=\S)`, 'g'),
    '$1---\n\n',
  );
  out = out.replace(
    new RegExp(String.raw`(${hrDashes})\s+(?=#{1,6}\s)`, 'g'),
    '---\n\n',
  );
  // Trailing HR jammed onto a finished pipe row: `| … | ---`
  // Also `| … | --- 建议你…` (HR then prose on the same line).
  // Skip separator lines themselves (`| --- | --- | ---`) — those dashes are cells.
  out = out.replace(
    new RegExp(String.raw`(\|[^\n]*\|)[ \t]+(${hrDashes})(?=[ \t]+(?:$|\S)|$)`, 'gm'),
    (full, row: string, hr: string, offset: number, whole: string) => {
      if (/^[\s|:\-—–−－─━═]+$/.test(row)) return full;
      // Consume optional spaces after the dashes; leave following prose in place.
      let end = offset + full.length;
      while (end < whole.length && (whole[end] === ' ' || whole[end] === '\t')) end++;
      // Only treat as HR when dashes end the line or are followed by prose
      // (not another delimiter cell like `| --- | ---`).
      const next = whole.slice(end, end + 1);
      if (next === '|') return full;
      return `${row}\n\n---\n\n`;
    },
  );
  // Inline/path code then HR with no space: `` `D:\path\`--- ``
  out = out.replace(/(`)(-{3,})/g, '$1\n\n$2');

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
  // Heading then first ordered item on the same line: `## 快速操作步骤 1. 打开`
  // Use [ \t]+ (not \s+) so an already-split `\n1. next` is not re-matched.
  out = out.replace(
    /(^|\n)(#{1,6}[ \t]+[^\n]*?)[ \t]+(\d{1,2}\.\s+\S)/gm,
    '$1$2\n$3',
  );
  // Ordered list marker on its own line: `1.\n\n2025年...` should stay part of
  // the list item (otherwise the number becomes a separate paragraph).
  out = out.replace(
    /(^|\n)(\d{1,2}\.)[ \t]*\n{1,2}([ \t]*\*{0,2}\s*\d{4}年[^\n]*)/g,
    (full, lead: string, marker: string, rest: string) =>
      `${lead}${marker} ${String(rest || '').trimStart()}`,
  );
  // Smashed heading + body with no list/`---`: `## 小提示 如果你…` /
  // `## 为什么只有源码？ 因为…` / `## 总结 **…`. Keep titles that merely
  // contain `你` (`适合你`) intact — only peel known body openers.
  out = out.replace(
    /(^|\n)(#{1,6}[ \t]+[^\n]{1,60}?)[ \t]+((?:如果你|你当前|既然你|双击)\S|(?:因为|进入)[ \t]*\S|\*\*\S)/gm,
    '$1$2\n\n$3',
  );
  out = out.replace(
    /(^|\n)(#{1,6}[ \t]+[^\n]*?[？?])[ \t]+([\u4e00-\u9fff*])/gm,
    '$1$2\n\n$3',
  );
  // Empty numbered ATX heading then bold year title on the next paragraph:
  // `### 1.\n\n**2025年2月26日：…**` → `### 1. **2025年2月26日：…**`.
  // Models use this for timeline sections; without the join, remark renders a
  // bare "1." heading. Run AFTER heading-body peels so `**` openers are not
  // split back off. Only fires when the heading body is exactly `N.` and the
  // next paragraph starts with `**YYYY年`.
  out = out.replace(
    /(^|\n)(#{1,6}[ \t]+)(\d{1,2}\.)[ \t]*\n{1,2}([ \t]*\*\*\d{4}年[^\n]*)/g,
    (_full, lead: string, hashes: string, marker: string, rest: string) =>
      `${lead}${hashes}${marker} ${String(rest || '').trimStart()}`,
  );
  // Continue splitting `1. foo 2. bar` once an item already starts a line —
  // does not fire on mid-prose `图 1. …表 2.`. [ \t]+ avoids rematching across
  // the newline we just inserted (which would stall the loop at 3./4. and
  // never reach 4./5.). Skip figure/table captions inside an item (`见图 1.`).
  for (let i = 0; i < 8; i++) {
    const next = out.replace(
      /(^|\n)(\d{1,2}\.\s+[^\n]*?)[ \t]+(\d{1,2}\.\s+\S)/g,
      (full, lead: string, a: string, b: string) => {
        if (/(?:见|如|参考)?[图表]$/.test(a)) return full;
        return `${lead}${a}\n${b}`;
      },
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

  // Colon then a real bullet: `支持有限： - Mac通常…` / `文件夹： - \`checkpoints\``
  // (not `价格：约一百`).
  out = out.replace(/([：:])[ \t]+(-\s+[`\u4e00-\u9fffA-Za-z*])/g, '$1\n$2');
  // Sibling inline-code bullets on the SAME line: `- \`a\` - \`b\` - \`c\``.
  // Use [ \t]+ (not \s+) so an already-split `\n- \`next\`` is not re-matched.
  for (let i = 0; i < 8; i++) {
    const next = out.replace(
      /(^|\n)(-\s+`[^`\n]+`)[ \t]+(-\s+`)/g,
      '$1$2\n$3',
    );
    if (next === out) break;
    out = next;
  }
  // Continue splitting sibling bullets once a line already starts with `- `,
  // but never catalog lines (`- **/image** - 说明`).
  // [ \t]+ — same rematch-across-newline stall as ordered lists above.
  for (let i = 0; i < 8; i++) {
    const next = out.replace(
      /(^|\n)(-\s+(?!\*\*)[^\n]*?)[ \t]+(-\s+(?!\*\*)[`\u4e00-\u9fffA-Za-z*])/g,
      '$1$2\n$3',
    );
    if (next === out) break;
    out = next;
  }

  // End list lazy-continuation so `第二步：…` / tables are not trapped in the
  // previous bullet. Require `：`/`:`/space after 步 — not `第二步去验证`.
  out = out.replace(
    /(^|\n)([-*+] |\d{1,2}\. )([^\n]+)\n(第[一二三四五六七八九十百\d]+步(?:[:：]|[\s　]))/g,
    '$1$2$3\n\n$4',
  );

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
/**
 * Table-only recovery. Safe for Thought/CoT, where the prose-level reflows are
 * too aggressive but a smashed table is just as unreadable as in an answer.
 */
export function reflowCollapsedMarkdownTablesOnly(markdown: string): string {
  const src = normalizeMarkdownLineEndings(String(markdown || ''));
  if (!src) return src;

  let out = reflowOutsideFences(src, normalizePipeLookalikesInTableishLines);
  out = reflowOutsideFences(out, reflowCollapsedMarkdownTables);
  return out.replace(/\n{3,}/g, '\n\n');
}

export function reflowCollapsedMarkdownBlocks(markdown: string): string {
  const src = normalizeMarkdownLineEndings(String(markdown || ''));
  if (!src) return src;

  // Fenced diagrams draw rows with `│` on purpose — rewriting those to `|`
  // inside a fence shreds the figure, so stay outside fences here too.
  let out = reflowOutsideFences(src, normalizePipeLookalikesInTableishLines);
  // Undo mid-word hard wraps before structural splits so titles/tables see
  // whole tokens (`方案`, not `方` + `案`).
  out = reflowOutsideFences(out, unwrapHardWrappedProse);
  // Tables next: while a smashed table is still one line, the prose-level rules
  // below (`| … | **next**` → new block) cannot tell a row boundary from a
  // table→prose boundary and would tear the last cell out of its row.
  out = reflowOutsideFences(out, reflowCollapsedMarkdownTables);
  out = reflowOutsideFences(out, reflowHeadingsListsHrs);
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}
