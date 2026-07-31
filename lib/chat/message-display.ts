import type { Message } from '@/lib/chat/types';
import {
  contentHasThinkMarkup,
  extractThinkBlocks,
} from '@/lib/chat/think-tags';
import { stripFakeToolMarkup } from '@/lib/chat/tool-tags';
import { stripMessageStamp } from '@/lib/chat/time-context';

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
  return {
    content: stripMessageStamp(stripFakeToolMarkup(extracted.content)),
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
