import { describe, expect, it } from 'vitest';
import {
  normalizeIntegrationIds,
  parseChatRequestBody,
  validateChatMessages,
} from '@/lib/chat/server/request';

describe('chat request parsing', () => {
  it('applies chat API defaults for an empty body', () => {
    expect(parseChatRequestBody({})).toEqual({
      messages: undefined,
      model: 'deepseek-v4-flash-200k',
      temperature: 0.7,
      systemPrompt: '',
      referenceText: '',
      skills: [],
      memories: [],
      conversationId: '',
      enableSearch: true,
      integrations: [],
      autoReview: true,
      requestReview: false,
      reviewContext: null,
    });
  });

  it('keeps non-array messages for later validation', () => {
    expect(parseChatRequestBody({ messages: 'nope' }).messages).toBe('nope');
    expect(validateChatMessages('nope')).toBe(
      'Invalid request: messages must be an array.',
    );
  });

  it('normalizes integration ids and preserves review context', () => {
    const parsed = parseChatRequestBody({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'gpt-test',
      temperature: 0.2,
      integrations: [' Notion ', 'GMAIL', '', 12],
      enableSearch: false,
      autoReview: false,
      requestReview: true,
      reviewContext: { targetMessageId: 'a1', assistantText: 'done' },
    });

    expect(parsed.integrations).toEqual(['notion', 'gmail', '12']);
    expect(parsed.enableSearch).toBe(false);
    expect(parsed.autoReview).toBe(false);
    expect(parsed.requestReview).toBe(true);
    expect(parsed.reviewContext).toEqual({
      targetMessageId: 'a1',
      assistantText: 'done',
    });
  });

  it('rejects non-array messages and accepts arrays', () => {
    expect(validateChatMessages(null)).toBe('Invalid request: messages must be an array.');
    expect(validateChatMessages([])).toBeNull();
    expect(normalizeIntegrationIds('gmail')).toEqual([]);
  });
});
