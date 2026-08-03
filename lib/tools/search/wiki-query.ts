/**
 * Wikipedia MediaWiki search is brittle with bilingual titles like
 * "Bitcoin 比特币" — zh and en editions often both return empty.
 * Prefer a single-language entity string + matching lang.
 */

export type WikiLang = 'en' | 'zh';

const CJK_RE = /[\u4e00-\u9fff]/;
const LATIN_TOKEN_RE = /[A-Za-z][A-Za-z0-9._\-]*/g;

export function inferWikiLang(
  query: string,
  hint?: WikiLang | null,
  userAsk?: string,
): WikiLang {
  if (hint === 'en' || hint === 'zh') return hint;
  const ask = String(userAsk || '');
  if (CJK_RE.test(ask) && !/[A-Za-z]{3,}/.test(ask.replace(/https?:\/\/\S+/g, ''))) {
    return 'zh';
  }
  if (CJK_RE.test(ask)) return 'zh';
  const q = String(query || '');
  if (CJK_RE.test(q) && !LATIN_TOKEN_RE.test(q)) return 'zh';
  if (CJK_RE.test(q)) return 'zh';
  return 'en';
}

/** Strip the other script when both appear, keeping a wiki-friendly title. */
export function normalizeWikiQuery(
  query: string,
  opts?: { lang?: WikiLang | null; userAsk?: string },
): { query: string; lang: WikiLang } {
  const raw = String(query || '').trim().slice(0, 500);
  const lang = inferWikiLang(raw, opts?.lang, opts?.userAsk);
  if (!raw) return { query: '', lang };

  const hasCjk = CJK_RE.test(raw);
  const latinTokens = raw.match(LATIN_TOKEN_RE) || [];
  const hasLatin = latinTokens.length > 0;

  if (hasCjk && hasLatin) {
    if (lang === 'zh') {
      const cjkOnly = raw
        .replace(LATIN_TOKEN_RE, ' ')
        .replace(/[()[\]{}（）【】]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return { query: cjkOnly || raw, lang };
    }
    // Prefer the longest Latin token (e.g. Bitcoin over BTC).
    const best = [...latinTokens].sort((a, b) => b.length - a.length)[0] || raw;
    return { query: best, lang };
  }

  return { query: raw, lang };
}
