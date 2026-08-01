import { describe, expect, it } from 'vitest';
import {
  analyzeTruncation,
  buildContinuationPrompt,
  looksAbruptlyCutOff,
  looksLikeToolNarration,
} from '@/lib/chat/stream/reply-truncation';

describe('reply truncation', () => {
  it('identifies unclosed code fences even when the provider reports a natural stop', () => {
    expect(analyzeTruncation('```ts\nconst answer = 42', 'stop')).toEqual({
      truncated: true,
      reason: 'Unclosed code block',
    });
  });

  it('does not keep a stale incomplete flag after a natural finish', () => {
    expect(analyzeTruncation('完整回答。', 'stop', true)).toEqual({
      truncated: false,
      reason: '',
    });
  });

  it('honors an authoritative server truncation event', () => {
    expect(
      analyzeTruncation('回答尚未结束', 'stop', false, undefined, {
        serverTruncated: true,
        serverReason: 'Output token limit reached',
      }),
    ).toEqual({
      truncated: true,
      reason: 'Output token limit reached',
    });
  });

  it('detects an unfinished markdown section', () => {
    expect(looksAbruptlyCutOff('## 下一步')).toEqual({
      truncated: true,
      reason: 'Stopped mid-section',
    });
  });

  it('does not mistake capability disclaimers for tool narration', () => {
    expect(looksLikeToolNarration('我无法扫描工作区，但可以解释这个错误。')).toBe(false);
  });

  it('builds a continuation prompt that closes an open code block', () => {
    const prompt = buildContinuationPrompt('```ts\nconst answer =');
    expect(prompt).toContain('You stopped inside a fenced code block');
    expect(prompt).toContain('<<<TAIL');
  });
});
