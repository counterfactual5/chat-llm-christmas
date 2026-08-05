/**
 * Restore GFM tables that models (esp. GLM) emit with row newlines collapsed
 * into spaces, or with a prose title jammed onto the header line.
 */

const SEP_CELL = String.raw`:?-{3,}:?`;
const SEP_ROW = new RegExp(
  String.raw`(?:\|?\s*${SEP_CELL}\s*){2,}\|?`,
);

function pipeCount(text: string): number {
  return (String(text || '').match(/\|/g) || []).length;
}

/** Split a table row into cell texts (no leading/trailing empty from edge pipes). */
export function splitMarkdownTableCells(line: string): string[] {
  let s = String(line || '').trim();
  if (!s) return [];
  // Drop a trailing thematic-break fragment jammed after the row.
  s = s.replace(/\s*\|\s*-{3,}\s*$/u, ' |').replace(/\s+---+\s*$/u, '');
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function formatMarkdownTableRow(cells: string[]): string {
  return `| ${cells.map((c) => c.trim()).join(' | ')} |`;
}

function isSeparatorLine(line: string): boolean {
  const t = String(line || '').trim();
  if (!SEP_ROW.test(t)) return false;
  // Must be mostly dashes/pipes/colons/spaces — not a data row.
  return /^[\s|:\-]+$/.test(t) && pipeCount(t) >= 2;
}

/** True when a single line/paragraph looks like a smashed multi-row table. */
export function looksLikeCollapsedMarkdownTable(text: string): boolean {
  const t = String(text || '').trim();
  if (!t.includes('|') || t.includes('\n')) return false;
  if (!SEP_ROW.test(t)) return false;
  return pipeCount(t) >= 6;
}

/**
 * Normalize fullwidth pipes and peel a prose title stuck on the header line
 * when the following line is a GFM separator.
 *
 * Example (GFM fails when header has 4 cells and sep has 3):
 * `⚠️ 标题 | 平台 | 状态 | 说明 |\n|------|------|------|`
 */
/** Next non-empty line index after `from` (exclusive of blanks). */
function nextNonEmptyLineIndex(lines: string[], from: number): number {
  for (let j = from; j < lines.length; j++) {
    if (String(lines[j] || '').trim()) return j;
  }
  return -1;
}

export function repairGfmTableStructure(markdown: string): string {
  // Pipes / line endings are normalized in reflowCollapsedMarkdownBlocks; keep a
  // local copy so this helper stays safe when called alone in tests.
  let src = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u2028|\u2029/g, '\n')
    .replace(/[\uFF5C\u2502\u2503\u2223\u4E28\u00A6\uFFE8]/g, '|')
    // Fancy dashes in separator rows — GFM only accepts ASCII `-`.
    .replace(/[—–−－─━═]/g, '-');
  if (!src.includes('|')) return src;

  const lines = src.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    // Models often leave a blank line between a jammed title+header and `|---|`.
    const sepIdx = nextNonEmptyLineIndex(lines, i + 1);
    const next = sepIdx >= 0 ? lines[sepIdx]! : '';

    if (isSeparatorLine(next) && line.includes('|')) {
      const peeled = peelTitleFromHeaderLine(line, next);
      if (peeled) {
        out.push(...peeled);
        // Keep any blank lines before the separator; then emit sep + continue.
        if (sepIdx > i + 1) {
          for (let b = i + 1; b < sepIdx; b++) out.push(lines[b]!);
        }
        out.push(next);
        i = sepIdx;
        continue;
      }
    }

    // Orphan data row: lost leading `|`, optional trailing `---`
    // `**Web3.career** 中文版 | ⚠️ 不确定 | 主站还在… | ---`
    const orphan = repairOrphanTableRow(line, out);
    if (orphan !== null) {
      out.push(...orphan);
      continue;
    }

    // Trailing empty cell: `| … | |` → `| … |`
    if (/\|[^|\n]+\|\s*\|\s*$/.test(line) && pipeCount(line) >= 4) {
      line = line.replace(/\|\s*\|\s*$/, '|');
    }

    // Orphan separator after prose/heading (model dropped the header row):
    // `### 第二步\n|------|------|\n| a | b |` → insert an empty header so GFM
    // still builds a table.
    if (isSeparatorLine(line)) {
      const prev = [...out].reverse().find((l) => String(l || '').trim()) || '';
      const prevTrim = prev.trim();
      const nextLine = lines[i + 1] ?? '';
      const cols = splitMarkdownTableCells(line).filter((c) =>
        /^:?-{3,}:?$/.test(c),
      ).length;
      if (
        cols >= 2 &&
        prevTrim &&
        !prevTrim.startsWith('|') &&
        !isSeparatorLine(prevTrim) &&
        nextLine.trim().startsWith('|') &&
        !isSeparatorLine(nextLine)
      ) {
        // Non-empty placeholders — blank cells (`|  |  |`) are mistaken for
        // smashed row boundaries by reflowCollapsedMarkdownTables.
        out.push(
          formatMarkdownTableRow(Array.from({ length: cols }, () => '-')),
        );
      }
    }

    out.push(line);
  }

  return out.join('\n');
}

function peelTitleFromHeaderLine(
  line: string,
  sepLine: string,
): string[] | null {
  const sepCells = splitMarkdownTableCells(sepLine).filter((c) =>
    /^:?-{3,}:?$/.test(c),
  );
  if (sepCells.length < 2) return null;

  // `title | 平台 | 状态 | 说明 |` — title has no pipes.
  const jammed = line.match(
    /^(.*?)(?:\s*)(\|\s*[^|\n]+(?:\s*\|\s*[^|\n]*){1,}\|\s*)$/u,
  );
  if (jammed) {
    const title = jammed[1]!.trim();
    let header = jammed[2]!.trim();
    if (
      title &&
      !title.includes('|') &&
      !/^\s*\|/.test(title) &&
      pipeCount(header) >= 2
    ) {
      const headerCells = splitMarkdownTableCells(header);
      if (headerCells.length >= sepCells.length) {
        // Prefer exactly sep column count from the right.
        const cols = headerCells.slice(-sepCells.length);
        return [title, '', formatMarkdownTableRow(cols)];
      }
    }
  }

  // `| ⚠️ long title | 平台 | 状态 | 说明 |` with sep shorter by one.
  if (/^\s*\|/.test(line)) {
    const cells = splitMarkdownTableCells(line);
    if (
      cells.length === sepCells.length + 1 &&
      cells[0]!.replace(/\s+/g, '').length >= 8
    ) {
      return [cells[0]!.trim(), '', formatMarkdownTableRow(cells.slice(1))];
    }
  }

  // No-space join: `时间）| 平台 | 状态 | 说明 |`
  const noSpace = line.match(
    /^(.*?(?:\)|）|。|！|？|…|】|」))(\|\s*[^|\n]+(?:\s*\|\s*[^|\n]*){1,}\|\s*)$/u,
  );
  if (noSpace) {
    const title = noSpace[1]!.trim();
    const header = noSpace[2]!.trim();
    const headerCells = splitMarkdownTableCells(header);
    if (title && !title.includes('|') && headerCells.length >= sepCells.length) {
      return [
        title,
        '',
        formatMarkdownTableRow(headerCells.slice(-sepCells.length)),
      ];
    }
  }

  return null;
}

/**
 * If the previous output ended a table and this line looks like another row
 * without a leading pipe, restore it. Returns null when not applicable.
 */
function repairOrphanTableRow(
  line: string,
  prevLines: string[],
): string[] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('|') || !trimmed.includes('|')) return null;
  if (isSeparatorLine(trimmed)) return null;

  // Need a recent table context (separator or pipe row above).
  let sawTable = false;
  for (let j = prevLines.length - 1; j >= 0; j--) {
    const p = prevLines[j]!.trim();
    if (!p) continue;
    if (isSeparatorLine(p) || /^\|/.test(p)) {
      sawTable = true;
      break;
    }
    // Hit non-table prose — stop.
    break;
  }
  if (!sawTable) return null;

  let working = trimmed;
  let trailingHr = false;
  if (/\s+---+\s*$/.test(working)) {
    working = working.replace(/\s+---+\s*$/, '').trim();
    trailingHr = true;
  }
  const cells = splitMarkdownTableCells(
    working.startsWith('|') ? working : `| ${working}`,
  );
  // Need at least 2 cells to look like a row continuation.
  if (cells.length < 2) return null;
  // Avoid turning normal prose with a single pipe into a row.
  if (cells.length === 2 && cells.join('').length < 12) return null;

  const rows = [formatMarkdownTableRow(cells)];
  if (trailingHr) {
    rows.push('');
    rows.push('---');
    rows.push('');
  }
  return rows;
}

function isPipeRow(line: string): boolean {
  const t = String(line || '').trim();
  return t.startsWith('|') && t.endsWith('|') && pipeCount(t) >= 3;
}

/**
 * GFM table cells are phrasing-only (no real `<ul>`). Models jam `•` bullets
 * into one line — insert literal `<br>` so AnswerMarkdown’s expandLiteralBreaks
 * can turn them into line breaks.
 */
export function breakInlineCellBullets(cell: string): string {
  let s = String(cell || '');
  if (!/[•·●▪]/.test(s)) return s;
  // `例如：• foo` / `例如:• foo`
  s = s.replace(/([：:;；])\s*([•·●▪])\s*/g, '$1<br>$2 ');
  // Mid-cell siblings: `• foo • bar` / `foo • bar`
  s = s.replace(/([^\n])\s+([•·●▪])\s+/g, '$1<br>$2 ');
  s = s.replace(/^(?:<br\s*\/?>\s*)+/i, '');
  return s;
}

/** Apply breakInlineCellBullets to every data/header pipe row. */
export function reflowInlineListsInTableCells(markdown: string): string {
  const src = String(markdown || '');
  if (!src.includes('|') || !/[•·●▪]/.test(src)) return src;
  return src
    .split('\n')
    .map((line) => {
      if (!isPipeRow(line) || isSeparatorLine(line)) return line;
      const cells = splitMarkdownTableCells(line);
      if (!cells.some((c) => /[•·●▪]/.test(c))) return line;
      return formatMarkdownTableRow(cells.map(breakInlineCellBullets));
    })
    .join('\n');
}

/**
 * Models sometimes drop the `|---|` delimiter row, leaving the whole table as
 * literal pipe text. Restore it when a run of rows with a consistent column
 * count starts outside any existing table.
 */
export function insertMissingTableSeparator(markdown: string): string {
  const src = String(markdown || '');
  if (!src.includes('|')) return src;

  const lines = src.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    out.push(line);
    if (!isPipeRow(line) || isSeparatorLine(lines[i + 1] ?? '')) continue;

    // Only a header can start a table: the line above must not be table-ish.
    const prev = out[out.length - 2] ?? '';
    if (isPipeRow(prev) || isSeparatorLine(prev)) continue;

    const cols = splitMarkdownTableCells(line).length;
    if (cols < 2) continue;

    const body: string[] = [];
    while (
      isPipeRow(lines[i + 1 + body.length] ?? '') &&
      splitMarkdownTableCells(lines[i + 1 + body.length]!).length === cols
    ) {
      body.push(lines[i + 1 + body.length]!);
    }
    if (body.length < 2) continue;

    out.push(`|${' --- |'.repeat(cols)}`);
    out.push(...body);
    i += body.length;
  }

  return out.join('\n');
}

/**
 * Insert newlines between smashed table rows. Safe no-op when rows are already
 * separated or the text is not table-like.
 */
export function reflowCollapsedMarkdownTables(markdown: string): string {
  // Peel jammed titles / orphan rows first (works when sep/rows already have newlines).
  let src = insertMissingTableSeparator(repairGfmTableStructure(String(markdown || '')));
  if (!src.includes('|')) return src;

  if (SEP_ROW.test(src)) {
    src = src.replace(
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
              if (
                new RegExp(String.raw`^\|\s*${SEP_CELL}`).test(
                  `|${m.slice(m.indexOf('|') + 1)}`,
                )
              ) {
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
    // After splitting a one-line smash, peel titles and fix orphan rows again.
    src = repairGfmTableStructure(src);
  }

  // Valid tables still need jammed `•` lists broken onto <br> lines.
  return reflowInlineListsInTableCells(src);
}
