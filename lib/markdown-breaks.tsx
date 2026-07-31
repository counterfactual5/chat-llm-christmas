/**
 * Model answers often put literal `<br>` / `<br/>` inside GFM table cells.
 * react-markdown does not interpret raw HTML by default, so those tags show as
 * text. Expand them into real line breaks when rendering.
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

export function expandLiteralBreaks(node: ReactNode): ReactNode {
  return Children.map(node, (child, idx) => {
    if (typeof child === 'string' || typeof child === 'number') {
      const s = String(child);
      if (!BR_TOKEN.test(s)) return child;
      const parts = s.split(BR_TOKEN);
      return parts.map((part, i) =>
        BR_ONLY.test(part) ? (
          <br key={`br-${idx}-${i}`} />
        ) : (
          <Fragment key={`t-${idx}-${i}`}>{part}</Fragment>
        ),
      );
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
