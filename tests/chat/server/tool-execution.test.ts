import { describe, expect, it } from 'vitest';
import {
  buildToolFallbackQuery,
  toolArgumentsAreComplete,
  toolResultIndicatesFailure,
} from '@/lib/chat/server/tool-execution';

describe('tool execution helpers', () => {
  it('uses only the current ask for regular tool calls', () => {
    expect(
      buildToolFallbackQuery({
        toolCall: { name: 'web_search', arguments: '{"query":"ignored"}' },
        userAsk: 'Find current news',
        streamedContent: 'I will search.',
        workingMessages: [],
      }),
    ).toBe('Find current news');
  });

  it('adds recent tool receipts to a web reader fallback query', () => {
    const fallback = buildToolFallbackQuery({
      toolCall: { name: 'web_read', arguments: '{}' },
      userAsk: 'Read the linked article',
      streamedContent: 'Reading the result now.',
      workingMessages: [
        { role: 'tool', content: 'https://example.com/article' },
        { role: 'assistant', content: 'Next.' },
      ],
    });

    expect(fallback).toBe(
      '{}\nReading the result now.\nhttps://example.com/article\nRead the linked article',
    );
  });

  it('recognizes structured and known provider failures without flagging success', () => {
    expect(toolResultIndicatesFailure('{"ok": false}')).toBe(true);
    expect(toolResultIndicatesFailure('{"error":"missing page_id"}')).toBe(true);
    expect(toolResultIndicatesFailure('MCP error: unauthorized')).toBe(true);
    expect(toolResultIndicatesFailure('{"ok":true,"results":[]}')).toBe(false);
  });

  it('detects incomplete tool argument JSON', () => {
    expect(toolArgumentsAreComplete('')).toBe(true);
    expect(toolArgumentsAreComplete('{"query":"is:unread"}')).toBe(true);
    expect(toolArgumentsAreComplete('{"query":"is:unre')).toBe(false);
  });
});
