/**
 * Markdown emphasis/currency fixups that make CommonMark-flavored `**bold**`
 * and remark-math `$…$` cooperate with CJK punctuation and price strings.
 */
import { mapOutsideFences } from './shared';

/**
 * CommonMark won't treat `**“…”**` as bold when CJK quotation marks sit flush
 * against the markers. Move the quotes outside so emphasis still parses:
 * `**“text”**` → `“**text**”`.
 *
 * Also: `**更正引用：**文中` fails because a closing `**` preceded by punctuation
 * must be followed by whitespace/punctuation — move the trailing punct out:
 * `**更正引用：**文` → `**更正引用**：文`.
 *
 * Also: `约**$2,160**` fails — `$` is punctuation, so `**` after a letter is not
 * left-flanking. Move the currency symbol out: `约$**2,160**`.
 */
export function fixFlankingEmphasis(content: string): string {
  let out = String(content || '');
  out = out.replace(/\*\*([“「『"'])([\s\S]*?)([”」』"'])\*\*/g, '$1**$2**$3');
  // `**$2,160**` / `**€99**` after CJK/Latin letters — pull currency before opener.
  out = out.replace(/\*\*([￥$€£¥]+)(?=\d)/g, '$1**');
  // Trailing punct inside **…** that blocks the closer when the next char is prose.
  // CRITICAL: only treat `**` as an opener when it is left-flanking (start of
  // string / whitespace / opening punct). Otherwise the closer of a prior
  // `**我的建议**` is stolen as the opener and we get
  // `关了**，不要…了**` (literal asterisks).
  out = out.replace(
    /(^|[\s\n([{（【「『"'“‘])\*\*((?:(?!\*\*).)+?)([：:。.，,、！!？?；;])\*\*(?=\S)/g,
    '$1**$2**$3',
  );
  return out;
}

/**
 * GFM autolink + `**https://…**` fight when the closer is flush against
 * punctuation (`**url**(搜索` / `**url**（搜索`). Autolink swallows the trailing
 * `**` into the href and leaves a leading orphan `**` — common in table cells.
 * Rewrite to an explicit bold markdown link before remark parses.
 */
export function fixBoldWrappedUrls(content: string): string {
  return mapOutsideFences(String(content || ''), (segment) =>
    segment
      .replace(/\*\*(https?:\/\/[^\s*<>\]]+)\*\*/gi, (_full, url: string) => `**[${url}](${url})**`)
      .replace(/__(https?:\/\/[^\s_<>\]]+)__/gi, (_full, url: string) => `**[${url}](${url})**`),
  );
}

/**
 * `$64,000` … `$64,400` is parsed as one giant inline-math span by remark-math,
 * which eats markdown (`**bold**` → KaTeX ∗) between the prices. Escape $-before-
 * digits (currency) outside fences / $$ blocks. Real math still uses `$x$` / `$$`.
 */
export function escapeCurrencyDollars(content: string): string {
  return mapOutsideFences(String(content || ''), (segment) =>
    segment
      .split(/(\$\$[\s\S]*?\$\$)/g)
      .map((chunk) => {
        if (chunk.startsWith('$$')) return chunk;
        // $64,000 / $**2,160** (currency pulled before **) — not $x$ math.
        return chunk.replace(/(?<!\\)\$(?=(\d|\*\*\d))/g, '\\$');
      })
      .join(''),
  );
}
