/**
 * GFM bare autolinks treat CJK as URL path characters, so
 * `https://example.com/，搜索` becomes one oversized link.
 * Rewrite glued cases to an explicit markdown link before remark parses.
 */

import { mapOutsideFences } from '@/lib/markdown/math/shared';

/** CJK letters + fullwidth / CJK punctuation — not valid bare-autolink boundaries in GFM. */
const CJK_OR_FULLWIDTH =
  /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

/** Trailing punctuation GFM would drop from an autolink (when it is terminal). */
const TRAILING_URL_PUNCT = /[?!.,:*_~]+$/;

function trimAutolinkUrl(raw: string): { url: string; rest: string } {
  let url = String(raw || '');
  let rest = '';
  const cjkAt = url.search(CJK_OR_FULLWIDTH);
  if (cjkAt >= 0) {
    rest = url.slice(cjkAt);
    url = url.slice(0, cjkAt);
  }
  const punct = url.match(TRAILING_URL_PUNCT);
  if (punct && rest) {
    // Only peel trailing punct when CJK (or more prose) follows — keep interior commas.
    url = url.slice(0, -punct[0].length);
    rest = punct[0] + rest;
  }
  return { url, rest };
}

/**
 * When a bare `https://…` is flush against CJK / fullwidth text, emit `[url](url)`
 * so remark-gfm cannot swallow the following characters into the href.
 * Leaves normal bare URLs (space-separated) for GFM. Skips markdown link hrefs.
 */
export function fixGreedyAutolinks(content: string): string {
  return mapOutsideFences(String(content || ''), (segment) =>
    segment.replace(/https?:\/\/[^\s<>\]]+/gi, (raw, offset: number, whole: string) => {
      // Already an explicit markdown destination: `](https://…)`
      if (offset >= 2 && whole.slice(offset - 2, offset) === '](') return raw;
      // Angle autolink: `<https://…>`
      if (offset >= 1 && whole[offset - 1] === '<') return raw;

      const { url, rest } = trimAutolinkUrl(raw);
      if (!rest) return raw;
      if (!/^https?:\/\/.+/i.test(url)) return raw;
      return `[${url}](${url})${rest}`;
    }),
  );
}
