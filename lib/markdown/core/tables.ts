/**
 * Restore GFM tables that models (esp. GLM) emit with row newlines collapsed
 * into spaces, e.g. `| a | b | | --- | --- | | 1 | 2 |`.
 */

const SEP_CELL = String.raw`:?-{3,}:?`;
const SEP_ROW = new RegExp(
  String.raw`(?:\|?\s*${SEP_CELL}\s*){2,}\|?`,
);

function pipeCount(text: string): number {
  return (String(text || '').match(/\|/g) || []).length;
}

/** True when a single line/paragraph looks like a smashed multi-row table. */
export function looksLikeCollapsedMarkdownTable(text: string): boolean {
  const t = String(text || '').trim();
  if (!t.includes('|') || t.includes('\n')) return false;
  if (!SEP_ROW.test(t)) return false;
  return pipeCount(t) >= 6;
}

/**
 * Insert newlines between smashed table rows. Safe no-op when rows are already
 * separated or the text is not table-like.
 */
export function reflowCollapsedMarkdownTables(markdown: string): string {
  const src = String(markdown || '');
  if (!src.includes('|') || !SEP_ROW.test(src)) return src;

  return src.replace(
    /(^|\n)([^\n]*\|[^\n]*\|[^\n]*)(?=\n|$)/g,
    (full, lead: string, block: string) => {
      if (!looksLikeCollapsedMarkdownTable(block)) return full;

      let out = block;
      // `| cell | | --- |` → `| cell |\n| --- |`
      out = out.replace(/\|\s+\|(?=\s*:?-{3,})/g, '|\n|');
      // `| --- | --- | | cell` → `| --- | --- |\n| cell`
      out = out.replace(
        new RegExp(String.raw`((?:\|\s*${SEP_CELL}\s*)+\|)\s*\|`, 'g'),
        '$1\n|',
      );
      // Remaining `| … | | … |` row boundaries (both sides have ≥2 pipes).
      for (let i = 0; i < 12; i++) {
        const next = out.replace(
          /(\|[^\n]+?\|)\s+\|(?=[^\n]*\|)/g,
          (m, left: string) => {
            if (pipeCount(left) < 2) return m;
            // Don't split inside a separator row fragment.
            if (new RegExp(String.raw`^\|\s*${SEP_CELL}`).test(`|${m.slice(m.indexOf('|') + 1)}`)) {
              return m;
            }
            return `${left}\n|`;
          },
        );
        if (next === out) break;
        out = next;
      }
      return `${lead}${out}`;
    },
  );
}
