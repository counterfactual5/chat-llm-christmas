import type { Message } from '@/lib/chat/types';
import {
  contentHasThinkMarkup,
  extractThinkBlocks,
} from '@/lib/chat/message/think-tags';
import { stripFakeToolMarkup } from '@/lib/chat/message/tool-tags';
import { stripMessageStamp } from '@/lib/chat/context/time-context';
import {
  linkifyResearchCitations,
  researchSourceUrlMap,
} from '@/lib/chat/message/research-links';

/** Bracketed SSE notice injected on tools-round idle timeout (legacy + live). */
const TOOLS_TIMEOUT_NOTICE_RE =
  /(?:\n{0,2})?\[Stream timed out during tool use:[^\]]*\]\s*/gi;

/** Strip tool-round timeout banners so they do not pollute the answer body. */
export function stripToolsTimeoutNotice(text: string): string {
  return String(text || '')
    .replace(TOOLS_TIMEOUT_NOTICE_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimStart();
}

export function messagePlainText(message: Message): string {
  // Count visible turn text (answer + thinking) so Context used tracks rollback.
  return [message.content, message.reasoning].filter(Boolean).join('\n');
}

/** Strip leaked <think> / fake tool tags for display / export; merge into reasoning panel. */
export function displayAssistantParts(message: Message): { content: string; reasoning: string } {
  const hasThink = contentHasThinkMarkup(message.content);
  const extracted = hasThink
    ? extractThinkBlocks(message.content)
    : { content: message.content, reasoning: '' };
  let content = stripMessageStamp(stripFakeToolMarkup(extracted.content));
  content = stripToolsTimeoutNotice(content);
  if (message.research?.jobId) {
    content = linkifyResearchCitations(content, researchSourceUrlMap(message));
  }
  return {
    content,
    reasoning: [message.reasoning, extracted.reasoning].filter(Boolean).join('\n\n'),
  };
}

export function isAssistantError(message?: Message): boolean {
  return Boolean(
    message &&
      message.role === 'assistant' &&
      (message.content || '').trim().startsWith('Error:'),
  );
}
