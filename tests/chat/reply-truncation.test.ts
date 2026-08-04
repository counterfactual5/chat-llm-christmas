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

  it('clears recovered tools_timeout after a finished final answer', () => {
    const body = [
      '已整理成表格：',
      '',
      '| 分类 | 信息 |',
      '| --- | --- |',
      '| 收件人 | a@b.com |',
      '',
      '邮件尚未发送，请在弹卡中确认。',
    ].join('\n');
    expect(
      analyzeTruncation(body, 'stop', true, 'Stream timed out during tool use'),
    ).toEqual({ truncated: false, reason: '' });
    expect(
      analyzeTruncation(body, 'length', true, 'Stream timed out during tool use'),
    ).toEqual({ truncated: false, reason: '' });
    expect(
      analyzeTruncation(body, 'stop', false, undefined, {
        serverTruncated: true,
        serverReason: 'Stream timed out during tool use',
      }),
    ).toEqual({ truncated: false, reason: '' });
    expect(
      analyzeTruncation(body, 'length', false, undefined, {
        serverTruncated: true,
        serverReason: 'Stream timed out during tool use',
      }),
    ).toEqual({ truncated: false, reason: '' });
  });

  it('keeps tools_timeout when the body is still abrupt', () => {
    expect(
      analyzeTruncation('## 下一步', 'stop', true, 'Stream timed out during tool use'),
    ).toEqual({ truncated: true, reason: 'Stopped mid-section' });
  });
});
