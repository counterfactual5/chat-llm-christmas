/**
 * Claim Reviewer — public entry (barrel). Prefer importing from here so callers
 * stay stable; open the module that owns the behavior you are changing:
 *
 *  tool-claims.ts     narrated tool success / pending intent / mid-turn / receipts
 *  citation.ts        URL anchors vs retrieval evidence
 *  recalculation.ts   inline equations + table totals
 *  vulnerability.ts   secret / injection pattern scan
 *  code-quality.ts    correctness smells in fenced code
 *  completeness.ts    cutoff / unclosed fence / degenerate output
 *  staleness.ts       time-bound claims vs web_search/read freshness
 *  consistency.ts     same metric, conflicting values
 *  report.ts          plan/run local checks, merge, emit panel events
 *  verifier.ts        LLM second opinion + correction verify prompts
 *  types.ts / shared.ts   shared shapes and text helpers
 *  evidence.ts        evidence units / strength / claim verdicts
 *
 * Product capability (not MCP, not a model-callable tool).
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
