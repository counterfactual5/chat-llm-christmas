/**
 * Cursor Auto / some gateway models emit chain-of-thought as XML-ish tags
 * inside the normal content stream (`<think>…</think>`), not as a separate
 * reasoning field. These helpers peel that out so the UI can show a Thought
 * panel instead of leaking tags into the answer.
 */

import {
  createOpenCloseStreamParser,
  incompleteTagHold,
} from '@/lib/chat/message/stream-xml-tags';

const OPEN_RE = /<(think|thinking)\b[^>]*>/i;
const CLOSE_RE = /<\/(think|thinking)>/i;

const HOLD_NAMES = ['think', 'thinking'] as const;

function hold(buffer: string): number {
  return incompleteTagHold(buffer, (partial) =>
    HOLD_NAMES.some((n) => n.startsWith(partial)),
  );
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
  const parser = createOpenCloseStreamParser({
    openRe: OPEN_RE,
    closeRe: CLOSE_RE,
    hold,
    orphanCloseAsInside: true,
  });

  const fold = (batch: ReturnType<typeof parser.push>) => {
    let content = '';
    let reasoning = '';
    for (const s of batch.segments) {
      if (s.kind === 'outside') content += s.text;
      else reasoning += s.text;
    }
    return {
      content,
      reasoning,
      orphanClose: batch.orphanClose,
    };
  };

  return {
    push(chunk: string) {
      return fold(parser.push(chunk));
    },
    flush() {
      return fold(parser.flush());
    },
    get inThink() {
      return parser.inside;
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
