import { describe, expect, it } from 'vitest';
import { getReviewCheckTitleKey } from '@/lib/chat/message/review-labels';
import type { ReviewCheckKind } from '@/lib/tools/review/claim-reviewer';

describe('getReviewCheckTitleKey', () => {
  it('maps every known kind to its dedicated title key', () => {
    const expected: Record<Exclude<ReviewCheckKind, 'vulnerability'>, string> = {
      mid_turn: 'reviewMidTurn',
      tool_receipt: 'reviewToolReceipt',
      citation: 'reviewCitation',
      staleness: 'reviewStaleness',
      recalculation: 'reviewRecalculation',
      consistency: 'reviewConsistency',
      completeness: 'reviewCompleteness',
      code_quality: 'reviewCodeQuality',
    };
    for (const [kind, key] of Object.entries(expected)) {
      expect(getReviewCheckTitleKey(kind as ReviewCheckKind)).toBe(key);
    }
  });

  it('falls back to reviewVulnerability for the vulnerability kind and unknown values', () => {
    expect(getReviewCheckTitleKey('vulnerability')).toBe('reviewVulnerability');
    expect(getReviewCheckTitleKey('unknown_kind' as ReviewCheckKind)).toBe('reviewVulnerability');
  });
});
