import { describe, expect, it } from 'vitest';
import {
  buildToolFallbackQuery,
  mergeToolCallArgumentChunks,
  normalizeToolCallArguments,
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

  it('normalizes truncated tool arguments to empty object JSON', () => {
    expect(normalizeToolCallArguments('')).toBe('{}');
    expect(normalizeToolCallArguments('{"query":"ok"}')).toBe('{"query":"ok"}');
    expect(normalizeToolCallArguments('{"query":"is:unre')).toBe('{}');
    expect(normalizeToolCallArguments('{')).toBe('{}');
    expect(normalizeToolCallArguments('"just-a-string"')).toBe('{}');
    expect(normalizeToolCallArguments('[]')).toBe('{}');
    expect(normalizeToolCallArguments('{"query":"a"}{"query":"b"}')).toBe('{}');
  });

  it('merges argument deltas and prefers a full-object resend', () => {
    expect(mergeToolCallArgumentChunks('{"q', '":"x"}')).toBe('{"q":"x"}');
    expect(mergeToolCallArgumentChunks('{"query":"old"}', '{"query":"new"}')).toBe(
      '{"query":"new"}',
    );
  });
});
