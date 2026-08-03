import type { ClaimVerdict, EvidenceStrength, EvidenceUnit } from '@/lib/tools/review/core/evidence';

export type FakedToolSurface =
  | 'notion'
  | 'github'
  | 'gmail'
  | 'calendar'
  | 'drive'
  | 'web_search'
  | 'web_read'
  | 'save_skill'
  | 'create_file';

export type ReviewerPhase = 'mid' | 'audit' | 'requested';

export type ReviewFindingVerdict =
  | 'pending_intent'
  | 'unsupported'
  | 'tool_failed'
  | 'no_receipt';

export type ReviewFinding = {
  id: string;
  severity: 'error' | 'warn';
  surface: FakedToolSurface;
  verdict: ReviewFindingVerdict;
  claim: string;
  evidence: string;
};

/** A single retrieval hit the tools actually returned — basis for citation checks. */
export type ExecutionSource = {
  url: string;
  title?: string;
  snippet?: string;
};

export type ExecutionRecordEntry = {
  tool: string;
  provider?: string;
  ok: boolean;
  error?: string;
  query?: string;
  /** URLs the tool actually returned — basis for citation alignment. */
  urls?: string[];
  /** Richer hits (title/snippet) when the tool payload carries them. */
  sources?: ExecutionSource[];
  /**
   * Evidence units for claim verification (may include full web_read body).
   * Built at receipt time so citation checks can judge by evidence strength.
   */
  evidence?: EvidenceUnit[];
};

export type ClientToolRun = {
  name: string;
  status: string;
  query?: string;
  error?: string;
  provider?: string;
  results?: Array<{ url?: string; title?: string; snippet?: string; body?: string }>;
};

export type ChatMessageLike = {
  role?: string;
  content?: unknown;
  tool_call_id?: string;
  tool_calls?: Array<{ id?: string; function?: { name?: string } }>;
};

export type ReviewCheckKind =
  | 'mid_turn'
  | 'tool_receipt'
  | 'citation'
  | 'staleness'
  | 'recalculation'
  | 'consistency'
  | 'completeness'
  | 'code_quality'
  | 'vulnerability';

export type ReviewCheckStatus = 'running' | 'done' | 'skipped';

export type ReviewCheckItem = {
  severity: 'error' | 'warn';
  title: string;
  detail: string;
  /**
   * Stable correction-gate id (e.g. `tool_receipt:pending_intent`, `off-by-one`).
   * Prefer this over matching free-text titles — LLM lenses must not invent it.
   */
  ruleId?: string;
  /** Tool-receipt / citation verdict when the check carries one. */
  verdict?: string;
  /** Citation evidence strength when the check carries one. */
  evidenceStrength?: 'strong' | 'moderate' | 'weak';
  /** Tool-receipt surface (notion / web_search / …) when known. */
  surface?: string;
};

export type ReviewCheck = {
  id: ReviewCheckKind;
  kind: ReviewCheckKind;
  status: ReviewCheckStatus;
  /** Short one-line status for the collapsed row. */
  summary: string;
  clean?: boolean;
  items: ReviewCheckItem[];
  /** Optional expanded body (e.g. execution record dump). */
  body?: string;
};

export type ReviewReport = {
  phase: ReviewerPhase;
  status: 'running' | 'done';
  checks: ReviewCheck[];
};

/** Built-in reviewer checks (product layer, not MCP / model tools). Display order. */
export const REVIEWER_CHECK_KINDS: ReviewCheckKind[] = [
  'mid_turn',
  'tool_receipt',
  'citation',
  'staleness',
  'recalculation',
  'consistency',
  'completeness',
  'code_quality',
  'vulnerability',
];

/**
 * Everything a check may look at. Built once per audit so triggers stay cheap.
 */
export type ReviewInput = {
  assistantText: string;
  record: ExecutionRecordEntry[];
  findings: ReviewFinding[];
  phase: ReviewerPhase;
  midTurn?: MidTurnCorrection | null;
  /** The question being answered — completeness compares against it. */
  userAsk?: string;
  /** Stream was cut off (finish_reason=length, aborted, timeout). */
  truncated?: boolean;
  finishReason?: string | null;
  /** Injectable for deterministic staleness tests. */
  now?: Date;
};

export type MidTurnCorrectionKind = 'intent' | 'success';

export type MidTurnCorrection = {
  surfaces: FakedToolSurface[];
  kind: MidTurnCorrectionKind;
};

export type CitationAnchor = {
  url: string;
  /** Surrounding claim the citation is meant to support. */
  claim: string;
};

export type CitationAudit = {
  checked: number;
  matched: number;
  unsupported: string[];
  /**
   * Claims whose hard facts do not appear in available evidence.
   * Verdict depends on evidence strength (Foundry + OpenScience):
   *  - unverifiable: only search blurbs — absence ≠ false
   *  - unsupported: full page body was read and still missing
   */
  unsupportedClaims: Array<{
    url: string;
    claim: string;
    missing: string[];
    verdict: ClaimVerdict;
    strength: EvidenceStrength;
    evidenceId?: string;
  }>;
};

export type ReviewLens = 'tool_receipt' | 'citation' | 'consistency' | 'completeness' | 'staleness' | 'code_quality';

const LENS_KINDS: ReviewLens[] = [
  'tool_receipt',
  'citation',
  'consistency',
  'completeness',
  'staleness',
  'code_quality',
];

export type ReviewPlan = {
  /** Local checks that actually fired, in display order. */
  checks: ReviewCheck[];
  /** Whether to spend the one allowed LLM verifier call. */
  llm: boolean;
  /** Lenses to include in that call — empty when llm is false. */
  lenses: ReviewLens[];
  /** Why the scheduler decided to spend (or skip) the LLM call. */
  reason: string;
};

export type LensFinding = {
  lens: ReviewLens;
  severity: 'error' | 'warn';
  title: string;
  detail: string;
};

export type VerifierResult = {
  findings: ReviewFinding[];
  lens: LensFinding[];
};

/** Prefer createStreamingVerifierComplete so the audit phase streams into Thought. */
export type LlmCompleteFn = (
  messages: Array<{ role: string; content: string }>,
) => Promise<string>;

export type ReviewIssue = {
  kind: ReviewCheckKind;
  severity: 'error' | 'warn';
  title: string;
  detail: string;
  ruleId?: string;
  verdict?: string;
  evidenceStrength?: 'strong' | 'moderate' | 'weak';
  /** Assistant message this issue was audited against (manual multi-turn). */
  sourceMessageId?: string;
};

export type CorrectionVerifyResult = {
  ok: boolean;
  text: string;
  /** Why the draft was rejected (when ok is false). */
  reason?: string;
};

export type ClaimAuditResult = {
  findings: ReviewFinding[];
  report: ReviewReport;
  issues: ReviewIssue[];
};
