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
  push: (chunk: string) => {
    content: string;
    reasoning: string;
    /** True when an orphan </think> was consumed — prior content should move to Thought. */
    orphanClose: boolean;
  };
  /** Flush any held partial tag text (e.g. stream ended mid-tag). */
  flush: () => { content: string; reasoning: string; orphanClose: boolean };
  readonly inThink: boolean;
};

/** Stateful splitter for streaming content chunks. */
export function createThinkStreamParser(): ThinkStreamParser {
  let buffer = '';
  let inThink = false;

  const consume = (
    final: boolean,
  ): { content: string; reasoning: string; orphanClose: boolean } => {
    let content = '';
    let reasoning = '';
    let orphanClose = false;

    while (buffer.length > 0) {
      if (!inThink) {
        const openMatch = buffer.match(OPEN_RE);
        const closeMatch = buffer.match(CLOSE_RE);
        const openIdx = openMatch?.index ?? -1;
        const closeIdx = closeMatch?.index ?? -1;

        // Orphan </think>: some models omit the opening tag and only emit the
        // close marker between a hidden draft and the real answer. Treat the
        // text before the close as reasoning.
        if (
          closeMatch &&
          closeIdx >= 0 &&
          (openIdx < 0 || closeIdx < openIdx)
        ) {
          reasoning += buffer.slice(0, closeIdx);
          buffer = buffer.slice(closeIdx + closeMatch[0].length);
          orphanClose = true;
          continue;
        }

        if (!openMatch || openIdx < 0) {
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
        content += buffer.slice(0, openIdx);
        buffer = buffer.slice(openIdx + openMatch[0].length);
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

    return { content, reasoning, orphanClose };
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
