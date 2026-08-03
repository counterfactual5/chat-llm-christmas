import type { ReviewCheck, ReviewCheckItem } from '@/lib/tools/review/core/types';
import {
  formatNumber,
  isTableSeparator,
  parseNumberToken,
  splitTableRow,
  stripCodeBlocks,
} from '@/lib/tools/review/core/shared';

type Token = { type: 'num'; value: number } | { type: 'op'; value: string } | { type: 'paren'; value: '(' | ')' };

const OP_PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

function normalizeOperator(ch: string): string | null {
  if (ch === '+' || ch === '＋') return '+';
  if (ch === '-' || ch === '－' || ch === '−') return '-';
  if (ch === '*' || ch === '×' || ch === '·') return '*';
  if (ch === '/' || ch === '÷') return '/';
  return null;
}

function tokenizeArithmetic(expr: string): Token[] | null {
  const tokens: Token[] = [];
  const src = String(expr || '');
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[\d.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[\d.,_]/.test(src[j])) j++;
      const numRaw = src.slice(i, j);
      let value = parseNumberToken(numRaw);
      if (!Number.isFinite(value)) return null;
      // Percent literal folds into a fraction so 20% * 50 works.
      if (src[j] === '%' || src[j] === '％') {
        value = value / 100;
        j++;
      }
      tokens.push({ type: 'num', value });
      i = j;
      continue;
    }
    if (ch === '(' || ch === '（') {
      tokens.push({ type: 'paren', value: '(' });
      i++;
      continue;
    }
    if (ch === ')' || ch === '）') {
      tokens.push({ type: 'paren', value: ')' });
      i++;
      continue;
    }
    const op = normalizeOperator(ch);
    if (op) {
      tokens.push({ type: 'op', value: op });
      i++;
      continue;
    }
    return null;
  }
  return tokens.length ? tokens : null;
}

function evaluateArithmetic(expr: string): number | null {
  const tokens = tokenizeArithmetic(expr);
  if (!tokens) return null;

  const output: Token[] = [];
  const ops: Token[] = [];
  let prev: Token | null = null;

  for (const token of tokens) {
    if (token.type === 'num') {
      output.push(token);
    } else if (token.type === 'op') {
      // Unary +/- becomes 0 <op> value.
      const isUnary =
        !prev || (prev.type === 'op') || (prev.type === 'paren' && prev.value === '(');
      if (isUnary) {
        if (token.value !== '+' && token.value !== '-') return null;
        output.push({ type: 'num', value: 0 });
      }
      while (
        ops.length &&
        ops[ops.length - 1].type === 'op' &&
        OP_PRECEDENCE[(ops[ops.length - 1] as { value: string }).value] >=
          OP_PRECEDENCE[token.value]
      ) {
        output.push(ops.pop()!);
      }
      ops.push(token);
    } else if (token.value === '(') {
      ops.push(token);
    } else {
      let matched = false;
      while (ops.length) {
        const top = ops.pop()!;
        if (top.type === 'paren' && top.value === '(') {
          matched = true;
          break;
        }
        output.push(top);
      }
      if (!matched) return null;
    }
    prev = token;
  }
  while (ops.length) {
    const top = ops.pop()!;
    if (top.type === 'paren') return null;
    output.push(top);
  }

  const stack: number[] = [];
  for (const token of output) {
    if (token.type === 'num') {
      stack.push(token.value);
      continue;
    }
    if (token.type !== 'op') return null;
    const b = stack.pop();
    const a = stack.pop();
    if (a == null || b == null) return null;
    if (token.value === '+') stack.push(a + b);
    else if (token.value === '-') stack.push(a - b);
    else if (token.value === '*') stack.push(a * b);
    else {
      if (b === 0) return null;
      stack.push(a / b);
    }
  }
  if (stack.length !== 1 || !Number.isFinite(stack[0])) return null;
  return stack[0];
}

function matchesWithinRounding(actual: number, claimedRaw: string, claimed: number): boolean {
  const tolerance = Math.max(1e-9, Math.abs(actual) * 1e-9);
  if (Math.abs(actual - claimed) <= tolerance) return true;
  const decimals = (claimedRaw.split(/[.]/)[1] || '').replace(/[^\d]/g, '').length;
  const factor = 10 ** decimals;
  if (Math.abs(Math.round(actual * factor) / factor - claimed) <= tolerance) return true;
  // Significant-figure rounding (1234 → 1200) stays acceptable for prose.
  if (decimals === 0 && Math.abs(actual) >= 100) {
    const rel = Math.abs(actual - claimed) / Math.abs(actual);
    if (rel <= 0.005) return true;
  }
  return false;
}

const EQUATION_RE =
  /(?<![\w.])((?:\(?\s*[-−]?\s*[\d][\d.,_]*\s*[%％]?\s*\)?(?:\s*[+\-−＋－*/×÷·]\s*\(?\s*[\d][\d.,_]*\s*[%％]?\s*\)?)+))\s*[=＝]\s*([-−]?\s*[\d][\d.,_]*)\s*([%％])?/g;

type EquationFinding = { expression: string; actual: number; claimed: number };

function verifyInlineEquations(text: string): {
  checked: number;
  mismatches: EquationFinding[];
} {
  const mismatches: EquationFinding[] = [];
  let checked = 0;

  for (const match of text.matchAll(EQUATION_RE)) {
    const lhsRaw = match[1];
    const rhsRaw = match[2];
    const rhsPercent = Boolean(match[3]);

    let actual = evaluateArithmetic(lhsRaw);
    if (actual == null) continue;
    const claimed = parseNumberToken(rhsRaw.replace(/[−]/g, '-'));
    if (!Number.isFinite(claimed)) continue;

    // Percent literals are folded to fractions while tokenizing, so a percent
    // claim ("12 / 50 = 24%", "50% + 30% = 80%") scales back up here.
    if (rhsPercent) actual *= 100;

    checked++;
    if (!matchesWithinRounding(actual, rhsRaw, claimed)) {
      mismatches.push({
        expression: `${lhsRaw.trim()} = ${rhsRaw.trim()}${rhsPercent ? '%' : ''}`,
        actual,
        claimed,
      });
    }
  }
  return { checked, mismatches };
}

const TOTAL_ROW_RE =
  /^\s*\**\s*(?:合计|总计|小计|总和|汇总|(?:total|totals|sum|subtotal)\b)/i;

const NON_SUM_TOTAL_RE =
  /均价|均值|平均|加权|avg\b|average|mean|weighted|median|中位/i;

function cellNumber(cell: string): number | null {
  const raw = String(cell || '').replace(/[*_`]/g, '').trim();
  if (!raw) return null;
  const m = raw.match(/^[¥$€£]?\s*([-−]?[\d][\d.,_]*)\s*[%％]?$/);
  if (!m) return null;
  const value = parseNumberToken(m[1].replace(/[−]/g, '-'));
  return Number.isFinite(value) ? value : null;
}

function verifyTableTotals(text: string): {
  checked: number;
  mismatches: Array<{ label: string; column: string; actual: number; claimed: number }>;
} {
  const lines = String(text || '').split('\n');
  const mismatches: Array<{ label: string; column: string; actual: number; claimed: number }> = [];
  let checked = 0;

  let i = 0;
  while (i < lines.length) {
    if (!lines[i].includes('|') || !isTableSeparator(lines[i + 1] || '')) {
      i++;
      continue;
    }
    const header = splitTableRow(lines[i]);
    let j = i + 2;
    const body: string[][] = [];
    while (j < lines.length && lines[j].includes('|') && lines[j].trim()) {
      body.push(splitTableRow(lines[j]));
      j++;
    }

    const totalRows = body.filter((row) => {
      const label = row[0] || '';
      return TOTAL_ROW_RE.test(label) && !NON_SUM_TOTAL_RE.test(label);
    });
    const dataRows = body.filter((row) => !TOTAL_ROW_RE.test(row[0] || ''));

    if (totalRows.length && dataRows.length >= 2) {
      for (const totalRow of totalRows) {
        for (let col = 1; col < header.length; col++) {
          const claimed = cellNumber(totalRow[col] || '');
          if (claimed == null) continue;
          const values = dataRows
            .map((row) => cellNumber(row[col] || ''))
            .filter((v): v is number => v != null);
          if (values.length < 2 || values.length !== dataRows.length) continue;
          const actual = values.reduce((a, b) => a + b, 0);
          checked++;
          if (!matchesWithinRounding(actual, totalRow[col] || '', claimed)) {
            mismatches.push({
              label: (totalRow[0] || 'total').replace(/[*_`]/g, '').trim(),
              column: (header[col] || `col ${col + 1}`).replace(/[*_`]/g, '').trim(),
              actual,
              claimed,
            });
          }
        }
      }
    }
    i = j + 1;
  }
  return { checked, mismatches };
}

export function buildRecalculationCheck(assistantText: string): ReviewCheck | null {
  const text = stripCodeBlocks(assistantText);
  if (!text.trim()) return null;

  const items: ReviewCheckItem[] = [];
  const inline = verifyInlineEquations(text);
  const tables = verifyTableTotals(text);
  const checked = inline.checked + tables.checked;
  if (checked === 0) return null;

  for (const m of inline.mismatches.slice(0, 8)) {
    items.push({
      severity: 'error',
      title: m.expression,
      detail: `Verified as ${formatNumber(m.actual)} (answer said ${formatNumber(m.claimed)})`,
      ruleId: 'recalculation:inline_mismatch',
    });
  }
  for (const m of tables.mismatches.slice(0, 8)) {
    items.push({
      severity: 'error',
      title: `${m.label} · ${m.column}`,
      detail: `Column verifies as ${formatNumber(m.actual)} (table said ${formatNumber(m.claimed)})`,
      ruleId: 'recalculation:table_mismatch',
    });
  }

  const scopeBits: string[] = [];
  if (inline.checked) scopeBits.push(`${inline.checked} expression(s)`);
  if (tables.checked) scopeBits.push(`${tables.checked} table total(s)`);

  return {
    id: 'recalculation',
    kind: 'recalculation',
    status: 'done',
    clean: items.length === 0,
    summary:
      items.length === 0
        ? `Checked ${scopeBits.join(' + ')}`
        : `${items.length} mismatch(es) in ${scopeBits.join(' + ')}`,
    items,
  };
}
