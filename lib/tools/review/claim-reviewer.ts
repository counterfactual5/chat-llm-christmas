/**
 * Claim Reviewer — public entry (barrel). Prefer importing from here so callers
 * stay stable; open the module that owns the behavior you are changing:
 *
 *  checks/tool-claims     narrated tool success / pending intent / mid-turn / receipts
 *  checks/citation        URL anchors vs retrieval evidence
 *  checks/recalculation   inline equations + table totals
 *  checks/vulnerability   secret / injection pattern scan
 *  checks/code-quality    correctness smells in fenced code
 *  checks/completeness    cutoff / unclosed fence / degenerate output
 *  checks/staleness       time-bound claims vs web_search/read freshness
 *  checks/consistency     same metric, conflicting values
 *  report.ts              plan/run local checks, merge, emit panel events
 *  verifier.ts            LLM second opinion + correction verify prompts
 *  types.ts / shared.ts   shared shapes and text helpers
 *  evidence.ts            evidence units / strength / claim verdicts
 *
 * Product capability (not MCP, not a model-callable tool).
 */

export { getReviewGateLevel } from '@/lib/tools/review/core/evidence';
export type { ClaimVerdict, EvidenceStrength, EvidenceUnit, ReviewGateLevel } from '@/lib/tools/review/core/evidence';

export * from '@/lib/tools/review/core/types';

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
} from '@/lib/tools/review/core/shared';

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
} from '@/lib/tools/review/checks/tool-claims';

export {
  extractCitationAnchors,
  formatReviewClaimTitle,
  auditCitations,
  buildCitationCheck,
} from '@/lib/tools/review/checks/citation';

export { buildRecalculationCheck } from '@/lib/tools/review/checks/recalculation';
export { buildVulnerabilityCheck } from '@/lib/tools/review/checks/vulnerability';
export { buildCodeQualityCheck } from '@/lib/tools/review/checks/code-quality';
export { detectDegenerateOutput, buildCompletenessCheck } from '@/lib/tools/review/checks/completeness';
export { buildStalenessCheck } from '@/lib/tools/review/checks/staleness';
export { buildConsistencyCheck } from '@/lib/tools/review/checks/consistency';

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
} from '@/lib/tools/review/core/report';

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
  buildManualReviewResponsePrompt,
  extractManualReviewFocus,
  FINDINGS_RESPONSE_SYSTEM,
  MANUAL_REVIEW_RESPONSE_SYSTEM,
} from '@/lib/tools/review/core/verifier';
