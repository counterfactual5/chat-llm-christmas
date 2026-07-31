/**
 * Cursor Auto (and similar agent models) often emit fake tool-call markup in
 * the normal content stream. This chat has no tool runtime, so we strip those
 * blocks instead of rendering them as real tool UI.
 */

const TAG_NAMES = [
  'tool_call',
  'tool_calls',
  'function_call',
  'function_calls',
  'invoke',
  'tool_request',
  'tool',
] as const;

const OPEN_RE = new RegExp(
  `<(?:${TAG_NAMES.join('|')})\\b[^>]*>`,
  'i',
);
const CLOSE_RE = new RegExp(
  `</(?:${TAG_NAMES.join('|')})>`,
  'i',
);

/** Incomplete open/close tag stuck at the end of a chunk — hold until next chunk. */
function incompleteTagHold(text: string): number {
  const lastLt = text.lastIndexOf('<');
  if (lastLt < 0) return -1;
  const tail = text.slice(lastLt);
  if (/>/.test(tail)) return -1;
  const m = tail.match(/^<\/?([a-z_]*)/i);
  if (!m) return -1;
  const partial = m[1].toLowerCase();
  // Bare "<" / "</" or a prefix / full name of a known tool tag.
  if (!partial) return lastLt;
  if (TAG_NAMES.some((n) => n.startsWith(partial))) return lastLt;
  return -1;
}

export type ToolCallStripper = {
  push: (chunk: string) => string;
  flush: () => string;
};

/** Remove fake tool-call XML from a streaming content channel. */
export function createToolCallStripper(): ToolCallStripper {
  let buffer = '';
  let inTool = false;

  const consume = (final: boolean): string => {
    let out = '';

    while (buffer.length > 0) {
      if (!inTool) {
        const openMatch = buffer.match(OPEN_RE);
        if (!openMatch || openMatch.index == null) {
          if (!final) {
            const holdAt = incompleteTagHold(buffer);
            if (holdAt >= 0) {
              out += buffer.slice(0, holdAt);
              buffer = buffer.slice(holdAt);
              break;
            }
          }
          out += buffer;
          buffer = '';
          break;
        }
        out += buffer.slice(0, openMatch.index);
        buffer = buffer.slice(openMatch.index + openMatch[0].length);
        inTool = true;
      } else {
        const closeMatch = buffer.match(CLOSE_RE);
        if (!closeMatch || closeMatch.index == null) {
          if (!final) {
            const holdAt = incompleteTagHold(buffer);
            if (holdAt >= 0) {
              buffer = buffer.slice(holdAt);
              break;
            }
          }
          buffer = '';
          break;
        }
        buffer = buffer.slice(closeMatch.index + closeMatch[0].length);
        inTool = false;
      }
    }

    return out;
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      return consume(false);
    },
    flush() {
      return consume(true);
    },
  };
}

/** One-shot cleanup for history / display. */
export function stripFakeToolMarkup(text: string): string {
  if (!text) return '';
  const stripper = createToolCallStripper();
  return (stripper.push(text) + stripper.flush()).replace(/\n{3,}/g, '\n\n');
}

export function contentHasToolMarkup(text: string): boolean {
  return OPEN_RE.test(text) || CLOSE_RE.test(text);
}
