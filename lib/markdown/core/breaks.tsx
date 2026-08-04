/**
 * Model answers often put literal `<br>` / `<br/>` or escaped `\n` inside GFM
 * table cells (tables cannot contain real newlines). react-markdown does not
 * interpret raw HTML by default, and `\n` shows as text. Expand both into real
 * line breaks when rendering — but only when `\n` looks like a prose linebreak
 * placeholder, not a documented escape / path fragment.
 *
 * Leading breaks are stripped so the cell does not start with a blank line.
 */

import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';

const BR_TOKEN = /(<br\s*\/?>)/i;
const BR_ONLY = /^<br\s*\/?>$/i;
const LEADING_BR = /^(?:<br\s*\/?>)+/i;
const TRAILING_BR = /(?:<br\s*\/?>)+$/i;

/**
 * True when literal `\n` in a table cell is likely “please break the line”
 * (e.g. email body jammed into a cell), not the escape token itself.
 */
export function looksLikeProseEscapedBreaks(s: string): boolean {
  const text = String(s || '');
  if (!/\\n/.test(text)) return false;

  // Cell is only escape tokens / whitespace → documenting `\n`, keep literal.
  if (!text.replace(/\\n/g, '').trim()) return false;

  // Short Windows-ish path (`C:\new…`) — `\n` is part of the path.
  const trimmed = text.trim();
  if (/^[A-Za-z]:\\/.test(trimmed) && trimmed.length < 96) return false;

  // Paragraph break is the strongest prose signal (email bodies, etc.).
  if (/\\n\\n/.test(text)) return true;

  // `\n` glued to CJK / alphanumerics on both sides (no spaces) → wrapped prose.
  // Spaced forms like `use \n for newline` stay literal.
  if (/[\u4e00-\u9fffA-Za-z0-9.!?。！？，、；：]\\n[\u4e00-\u9fffA-Za-z0-9]/.test(text)) {
    return true;
  }

  // Several segments with real text on both sides of `\n`.
  const parts = text.split(/\\n/);
  const meaty = parts.filter((p) => p.trim().length >= 2);
  return parts.length >= 3 && meaty.length >= 2;
}

/** Turn prose-like literal backslash-n sequences into `<br>`. */
export function normalizeEscapedNewlines(s: string): string {
  const text = String(s || '');
  if (!looksLikeProseEscapedBreaks(text)) return text;
  return text.replace(/\\n/g, '<br>');
}

function expandBreaksInString(s: string, keyPrefix: string): ReactNode {
  const trimmed = normalizeEscapedNewlines(s)
    .replace(LEADING_BR, '')
    .replace(TRAILING_BR, '');
  if (!trimmed) return null;
  if (!BR_TOKEN.test(trimmed)) return trimmed;

  const parts = trimmed.split(BR_TOKEN);
  const out: ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (BR_ONLY.test(part)) {
      // Skip leading/trailing break tokens and collapse runs.
      const prev = out[out.length - 1];
      const prevIsBr =
        isValidElement(prev) && (prev as ReactElement).type === 'br';
      if (out.length === 0 || prevIsBr) continue;
      out.push(<br key={`${keyPrefix}-br-${i}`} />);
      continue;
    }
    if (!part) continue;
    out.push(<Fragment key={`${keyPrefix}-t-${i}`}>{part}</Fragment>);
  }
  // Drop a trailing <br> if the last text part was empty (already skipped).
  while (
    out.length &&
    isValidElement(out[out.length - 1]) &&
    (out[out.length - 1] as ReactElement).type === 'br'
  ) {
    out.pop();
  }
  if (out.length === 0) return null;
  if (out.length === 1) return out[0];
  return out;
}

export function expandLiteralBreaks(node: ReactNode): ReactNode {
  return Children.map(node, (child, idx) => {
    if (typeof child === 'string' || typeof child === 'number') {
      return expandBreaksInString(String(child), `n${idx}`);
    }
    if (isValidElement(child)) {
      const el = child as ReactElement<{ children?: ReactNode }>;
      if (el.props?.children == null) return child;
      return cloneElement(el, {
        ...el.props,
        children: expandLiteralBreaks(el.props.children),
      });
    }
    return child;
  });
}
