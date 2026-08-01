import { describe, expect, it } from 'vitest';
import {
  extractToolCalls,
  lastUserText,
  looksLikeSearchRequest,
  narratesSearchInsteadOfCalling,
  sanitizeChatMessages,
  withMessageTimestamps,
} from '@/lib/chat/server/messages';

describe('chat message helpers', () => {
  it('detects clear search intents without treating every 查 as a hit', () => {
    expect(looksLikeSearchRequest('帮我搜一下最新融资')).toBe(true);
    expect(looksLikeSearchRequest('你好')).toBe(false);
  });

  it('ignores retracting / meta talk when detecting search narration', () => {
    expect(narratesSearchInsteadOfCalling('让我先搜索一下最新消息')).toBe(true);
    expect(narratesSearchInsteadOfCalling('不需要搜索，这是基础知识')).toBe(false);
  });

  it('extracts tool calls with stable fallback ids', () => {
    expect(
      extractToolCalls({
        tool_calls: [{ function: { name: 'web_search', arguments: '{"q":"a"}' } }],
      }),
    ).toEqual([{ id: 'call_0', name: 'web_search', arguments: '{"q":"a"}' }]);
  });

  it('reads the latest user text through array content parts', () => {
    expect(
      lastUserText([
        { role: 'assistant', content: 'hi' },
        {
          role: 'user',
          content: [{ type: 'text', text: '第一部分' }, { type: 'text', text: '第二部分' }],
        },
      ]),
    ).toBe('第一部分\n第二部分');
  });

  it('stamps only user messages and strips assistant stamp leaks', () => {
    const stamped = withMessageTimestamps([
      { role: 'user', content: 'hello', timestamp: Date.parse('2026-01-01T00:00:00.000Z') },
      {
        role: 'assistant',
        // Leading [YYYY-MM-DD ...] stamp is stripped; remaining prose is preserved.
        content: '[2026-01-01 08:00 +08:00] answer',
        timestamp: Date.parse('2026-01-01T00:00:00.000Z'),
      },
    ]);

    expect(String(stamped[0].content)).toContain('hello');
    expect(String(stamped[0].content)).toMatch(/\[2026-/);
    expect(String(stamped[1].content)).toBe('answer');
  });

  it('keeps only OpenAI-facing chat fields', () => {
    expect(
      sanitizeChatMessages([
        {
          role: 'assistant',
          content: 'x',
          tool_calls: [{ id: '1' }],
          images: [{ url: 'data:x' }],
          timestamp: 1,
        },
      ]),
    ).toEqual([{ role: 'assistant', content: 'x', tool_calls: [{ id: '1' }] }]);
  });
});
