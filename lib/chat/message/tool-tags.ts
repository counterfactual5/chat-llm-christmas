/**
 * Cursor Auto (and similar agent models) often emit fake tool-call markup in
 * the normal content stream. This chat has no tool runtime, so we strip those
 * blocks instead of rendering them as real tool UI.
 */

import {
  createOpenCloseStreamParser,
  incompleteTagHold,
} from '@/lib/chat/message/stream-xml-tags';

const TAG_NAMES = [
  'tool_call',
  'tool_calls',
  'function_call',
  'function_calls',
  'invoke',
  'tool_request',
  'tool',
] as const;

const OPEN_RE = new RegExp(`<(?:${TAG_NAMES.join('|')})\\b[^>]*>`, 'i');
const CLOSE_RE = new RegExp(`</(?:${TAG_NAMES.join('|')})>`, 'i');

function hold(buffer: string): number {
  return incompleteTagHold(buffer, (partial) =>
    TAG_NAMES.some((n) => n.startsWith(partial)),
  );
}

export type ToolCallStripper = {
  push: (chunk: string) => string;
  flush: () => string;
};

/** Remove fake tool-call XML from a streaming content channel. */
export function createToolCallStripper(): ToolCallStripper {
  const parser = createOpenCloseStreamParser({
    openRe: OPEN_RE,
    closeRe: CLOSE_RE,
    hold,
  });

  const fold = (batch: ReturnType<typeof parser.push>) =>
    batch.segments
      .filter((s) => s.kind === 'outside')
      .map((s) => s.text)
      .join('');

  return {
    push(chunk: string) {
      return fold(parser.push(chunk));
    },
    flush() {
      return fold(parser.flush());
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
