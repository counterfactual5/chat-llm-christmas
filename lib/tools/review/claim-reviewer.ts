/**
 * Claim Reviewer — single layer that catches narrated tool successes without
 * real tool_calls (mid-turn correction + post-audit). Product capability, not
 * MCP, not a model-callable tool.
 *
 * Reviewer v2 borrows from foundry-research (evidence units + claim verdicts)
 * and OpenScience (strength-graded findings, L0/L1 gate). Citation checks go
 * through `lib/review/evidence.ts` — blurbs cannot prove a figure wrong.
 */

export { getReviewGateLevel } from '@/lib/tools/review/evidence';
export type { ClaimVerdict, EvidenceStrength, EvidenceUnit, ReviewGateLevel } from '@/lib/tools/review/evidence';

export * from '@/lib/tools/review/types';

export {
  normalizeUrl,
  stripCodeBlocks,
  extractCodeBlocks,
  splitTableRow,
  isTableSeparator,
  extractUrls,
  clauseBefore,
  clauseAfter,
  hostOf,
  formatExecutionRecordForUi,
} from '@/lib/tools/review/shared';

export {
  REVIEWER_SYSTEM_PROMPT,
  detectFakedToolNarration,
  detectPendingToolIntent,
  buildCorrectionPrompt,
  buildPendingIntentPrompt,
  buildExecutionRecordFromMessages,
  lastUserMessageIndex,
  buildExecutionRecordFromToolRuns,
  filterSurfacesMissingReceipt,
  synthesizeFindings,
  buildMidTurnCheck,
  buildMidTurnLiveReport,
  emitMidTurnReview,
  buildToolReceiptCheck,
} from '@/lib/tools/review/tool-claims';

export {
  extractCitationAnchors,
  formatReviewClaimTitle,
  auditCitations,
  buildCitationCheck,
} from '@/lib/tools/review/citation';

export { buildRecalculationCheck } from '@/lib/tools/review/recalculation';
export { buildVulnerabilityCheck } from '@/lib/tools/review/vulnerability';
export { buildCodeQualityCheck } from '@/lib/tools/review/code-quality';
export { detectDegenerateOutput, buildCompletenessCheck } from '@/lib/tools/review/completeness';
export { buildStalenessCheck } from '@/lib/tools/review/staleness';
export { buildConsistencyCheck } from '@/lib/tools/review/consistency';

export {
  mergeReviewChecks,
  planReviewChecks,
  buildReviewReport,
  dedupeReviewChecks,
  applyLensFindings,
  emitReviewReport,
  emitReviewerFindings,
  runClaimAudit,
  emitReviewerStep,
} from '@/lib/tools/review/report';

export {
  VERIFIER_SYSTEM_PROMPT,
  buildVerifierSystemPrompt,
  formatExecutionRecordForVerifier,
  buildVerifierUserPrompt,
  parseVerifierResponse,
  mergeFindings,
  runLlmVerifier,
  runFullClaimAudit,
  actionableReviewIssues,
  looksLikeRestatedAnswer,
  verifyCorrectionText,
  rejectedCorrectionNote,
  collectReviewIssues,
  buildFindingsResponsePrompt,
  buildReviewIssuesResponsePrompt,
  FINDINGS_RESPONSE_SYSTEM,
} from '@/lib/tools/review/verifier';
