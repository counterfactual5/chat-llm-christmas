/**
 * Model answers often put literal `<br>` / `<br/>` or escaped `\n` inside GFM
 * table cells (tables cannot contain real newlines). react-markdown does not
 * interpret raw HTML by default, and `\n` shows as text. Expand both into real
 * line breaks when rendering.
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

/** Turn literal backslash-n sequences into `<br>` so one expander handles both. */
export function normalizeEscapedNewlines(s: string): string {
  return String(s || '').replace(/\\n/g, '<br>');
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
