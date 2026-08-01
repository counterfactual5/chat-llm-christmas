import { describe, expect, it } from 'vitest';
import {
  isReviewCommandPrefix,
  parseReviewCommand,
} from '@/lib/chat/turn/review-command';
import { buildClaimReviewUserPrompt } from '@/lib/chat/turn/continuation';

describe('parseReviewCommand', () => {
  it('parses bare /review and /审查', () => {
    expect(parseReviewCommand('/review')).toEqual({ focus: '' });
    expect(parseReviewCommand('/审查')).toEqual({ focus: '' });
  });

  it('captures focus text', () => {
    expect(parseReviewCommand('/review 重点核对价格与来源')).toEqual({
      focus: '重点核对价格与来源',
    });
  });

  it('returns null for unrelated text', () => {
    expect(parseReviewCommand('hello')).toBeNull();
    expect(parseReviewCommand('/research foo')).toBeNull();
  });

  it('detects bare prefix', () => {
    expect(isReviewCommandPrefix('/review')).toBe(true);
    expect(isReviewCommandPrefix('/review ')).toBe(true);
    expect(isReviewCommandPrefix('/review focus')).toBe(false);
  });
});

describe('buildClaimReviewUserPrompt', () => {
  it('appends focus when provided', () => {
    const p = buildClaimReviewUserPrompt('check ETH prices');
    expect(p).toContain('Claim Review');
    expect(p).toContain('Additional review focus');
    expect(p).toContain('check ETH prices');
  });

  it('omits focus section when empty', () => {
    expect(buildClaimReviewUserPrompt('')).not.toContain('Additional review focus');
  });
});
