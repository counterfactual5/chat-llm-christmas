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
  type LucideIcon,
} from 'lucide-react';
import type { ReviewCheckKind } from '@/lib/tools/review/claim-reviewer';

/** Map a review check kind to its icon component. */
export function getReviewCheckIcon(kind: ReviewCheckKind): LucideIcon {
  if (kind === 'mid_turn') return RotateCcw;
  if (kind === 'tool_receipt') return Wrench;
  if (kind === 'citation') return Link2;
  if (kind === 'staleness') return CalendarClock;
  if (kind === 'recalculation') return Calculator;
  if (kind === 'consistency') return Scale;
  if (kind === 'completeness') return ListChecks;
  if (kind === 'code_quality') return Bug;
  return ShieldAlert;
}
