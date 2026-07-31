/**
 * Cursor Auto / some gateway models emit chain-of-thought as XML-ish tags
 * inside the normal content stream (`<think>…</think>`), not as a separate
 * reasoning field. These helpers peel that out so the UI can show a Thought
 * panel instead of leaking tags into the answer.
 */

const OPEN_RE = /<(think|thinking)\b[^>]*>/i;
const CLOSE_RE = /<\/(think|thinking)>/i;

/** Incomplete open/close tag stuck at the end of a chunk — hold until next chunk. */
function incompleteTagHold(text: string): number {
  const lastLt = text.lastIndexOf('<');
  if (lastLt < 0) return -1;
  const tail = text.slice(lastLt);
  // Full tags already matched elsewhere; only hold unfinished prefixes.
  if (/>/.test(tail)) return -1;
  if (/^<\/?(?:t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?)?)?)?$/i.test(tail)) return lastLt;
  if (/^<\/?(?:think|thinking)\b[^>]*$/i.test(tail)) return lastLt;
  return -1;
}

export type ThinkStreamParser = {
  push: (chunk: string) => { content: string; reasoning: string };
  /** Flush any held partial tag text (e.g. stream ended mid-tag). */
  flush: () => { content: string; reasoning: string };
  readonly inThink: boolean;
};

/** Stateful splitter for streaming content chunks. */
export function createThinkStreamParser(): ThinkStreamParser {
  let buffer = '';
  let inThink = false;

  const consume = (final: boolean): { content: string; reasoning: string } => {
    let content = '';
    let reasoning = '';

    while (buffer.length > 0) {
      if (!inThink) {
        const openMatch = buffer.match(OPEN_RE);
        if (!openMatch || openMatch.index == null) {
          if (!final) {
            const holdAt = incompleteTagHold(buffer);
            if (holdAt >= 0) {
              content += buffer.slice(0, holdAt);
              buffer = buffer.slice(holdAt);
              break;
            }
          }
          content += buffer;
          buffer = '';
          break;
        }
        content += buffer.slice(0, openMatch.index);
        buffer = buffer.slice(openMatch.index + openMatch[0].length);
        inThink = true;
      } else {
        const closeMatch = buffer.match(CLOSE_RE);
        if (!closeMatch || closeMatch.index == null) {
          if (!final) {
            const holdAt = incompleteTagHold(buffer);
            if (holdAt >= 0) {
              reasoning += buffer.slice(0, holdAt);
              buffer = buffer.slice(holdAt);
              break;
            }
          }
          reasoning += buffer;
          buffer = '';
          break;
        }
        reasoning += buffer.slice(0, closeMatch.index);
        buffer = buffer.slice(closeMatch.index + closeMatch[0].length);
        inThink = false;
      }
    }

    return { content, reasoning };
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      return consume(false);
    },
    flush() {
      return consume(true);
    },
    get inThink() {
      return inThink;
    },
  };
}

/**
 * One-shot extraction for already-buffered text (history / display safety net).
 * Unclosed `<think>` bodies are treated as reasoning (common when the stream
 * was cut mid-thought).
 */
export function extractThinkBlocks(text: string): { content: string; reasoning: string } {
  if (!text) return { content: '', reasoning: '' };
  const parser = createThinkStreamParser();
  const a = parser.push(text);
  const b = parser.flush();
  return {
    content: (a.content + b.content).replace(/^\n+/, ''),
    reasoning: (a.reasoning + b.reasoning).trim(),
  };
}

/** True when visible answer text still contains think markup. */
export function contentHasThinkMarkup(text: string): boolean {
  return OPEN_RE.test(text) || CLOSE_RE.test(text);
}
