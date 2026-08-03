import { describe, expect, it } from 'vitest';
import {
  serializeReviewToolRuns,
  settleEmptyBodyAction,
  withEmptyReplyFallback,
  withMarkedAssistantIncomplete,
  withPromotedOrphanReasoning,
} from '@/lib/chat/session/mutations';
import type { ChatSession, Message } from '@/lib/chat/types';

function msg(partial: Partial<Message> & Pick<Message, 'id' | 'role' | 'content'>): Message {
  return {
    id: partial.id,
    role: partial.role,
    content: partial.content,
    timestamp: partial.timestamp ?? 1,
    incomplete: partial.incomplete,
    reasoning: partial.reasoning,
    truncationReason: partial.truncationReason,
  };
}

function session(messages: Message[]): ChatSession {
  return {
    id: 's1',
    title: 't',
    messages,
    updatedAt: 1,
  };
}

describe('session/mutations', () => {
  it('marks incomplete and clears truncation when complete', () => {
    const sessions = [
      session([
        msg({
          id: 'a',
          role: 'assistant',
          content: 'hi',
          incomplete: true,
          truncationReason: 'Stopped by you',
        }),
      ]),
    ];
    const marked = withMarkedAssistantIncomplete(sessions, 's1', 'a', true, {
      truncationReason: 'x',
    });
    expect(marked[0].messages[0].truncationReason).toBe('x');
    const done = withMarkedAssistantIncomplete(marked, 's1', 'a', false);
    expect(done[0].messages[0].incomplete).toBe(false);
    expect(done[0].messages[0].truncationReason).toBeUndefined();
  });

  it('promotes orphan reasoning and applies empty fallback', () => {
    const sessions = [
      session([
        msg({
          id: 'a',
          role: 'assistant',
          content: '',
          reasoning: 'thought',
          incomplete: true,
        }),
      ]),
    ];
    const promoted = withPromotedOrphanReasoning(sessions, 's1', 'a', 'thought');
    expect(promoted[0].messages[0].content).toBe('thought');
    expect(promoted[0].messages[0].reasoning).toBeUndefined();

    const fallback = withEmptyReplyFallback(sessions, 's1', 'a', '(empty)');
    expect(fallback[0].messages[0].content).toBe('(empty)');
    expect(fallback[0].messages[0].incomplete).toBe(false);
  });

  it('does not promote reasoning that was rewound by orphan </think>', () => {
    expect(
      settleEmptyBodyAction({
        suppressedOrphanPromote: true,
        reasoning: 'draft before close tag',
      }),
    ).toBe('thought_only');
    expect(
      settleEmptyBodyAction({
        suppressedOrphanPromote: false,
        reasoning: 'gateway put answer in reasoning',
      }),
    ).toBe('promote');
    expect(
      settleEmptyBodyAction({
        suppressedOrphanPromote: false,
        reasoning: '',
      }),
    ).toBe('empty_error');
  });

  it('serializes review tool runs with body cap', () => {
    const rows = serializeReviewToolRuns([
      {
        id: '1',
        name: 'web_search',
        status: 'done',
        query: 'q',
        results: [
          {
            title: 't',
            url: 'https://ex.com',
            snippet: 's',
            body: 'x'.repeat(20_000),
          },
        ],
      },
    ]);
    expect(rows[0].results?.[0].body?.length).toBe(16_000);
  });
});
