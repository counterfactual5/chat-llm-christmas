import { describe, expect, it } from 'vitest';
import {
  RotateCcw,
  Wrench,
  Link2,
  CalendarClock,
  Calculator,
  Scale,
  ListChecks,
  Bug,
  ShieldAlert,
} from 'lucide-react';
import { getReviewCheckIcon } from '@/components/chat/message/helpers/review-check-icon';
import type { ReviewCheckKind } from '@/lib/tools/review/claim-reviewer';

describe('getReviewCheckIcon', () => {
  it('maps every known kind to its dedicated icon', () => {
    const expected: Record<Exclude<ReviewCheckKind, 'vulnerability'>, unknown> = {
      mid_turn: RotateCcw,
      tool_receipt: Wrench,
      citation: Link2,
      staleness: CalendarClock,
      recalculation: Calculator,
      consistency: Scale,
      completeness: ListChecks,
      code_quality: Bug,
    };
    for (const [kind, icon] of Object.entries(expected)) {
      expect(getReviewCheckIcon(kind as ReviewCheckKind)).toBe(icon);
    }
  });

  it('falls back to ShieldAlert for the vulnerability kind', () => {
    expect(getReviewCheckIcon('vulnerability')).toBe(ShieldAlert);
  });
});
