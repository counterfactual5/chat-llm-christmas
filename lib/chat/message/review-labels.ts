import type { MessageKey } from '@/lib/i18n';
import type { ReviewCheckKind } from '@/lib/tools/review/claim-reviewer';

/** Map a review check kind to its i18n title key. Caller resolves via `t()`. */
export function getReviewCheckTitleKey(kind: ReviewCheckKind): MessageKey {
  if (kind === 'mid_turn') return 'reviewMidTurn';
  if (kind === 'tool_receipt') return 'reviewToolReceipt';
  if (kind === 'citation') return 'reviewCitation';
  if (kind === 'staleness') return 'reviewStaleness';
  if (kind === 'recalculation') return 'reviewRecalculation';
  if (kind === 'consistency') return 'reviewConsistency';
  if (kind === 'completeness') return 'reviewCompleteness';
  if (kind === 'code_quality') return 'reviewCodeQuality';
  return 'reviewVulnerability';
}
