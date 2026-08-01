/**
 * Request Review orchestration: turn a client-supplied `reviewContext` into
 * per-turn claim audits, then build the prompt for the dedicated (tools-off)
 * answer that addresses whatever the audits found.
 */

import type { ChatReviewContext, ChatReviewToolRun } from '@/lib/chat/server/request';
import {
  buildExecutionRecordFromToolRuns,
  buildFindingsResponsePrompt,
  buildReviewIssuesResponsePrompt,
  buildReviewReport,
  emitReviewReport,
  runFullClaimAudit,
  synthesizeFindings,
  FINDINGS_RESPONSE_SYSTEM,
  type LlmCompleteFn,
  type ReviewFinding,
  type ReviewIssue,
} from '@/lib/tools/review/claim-reviewer';

export type ReviewTurn = {
  messageId: string;
  assistantText: string;
  toolRuns?: ChatReviewToolRun[];
};

/**
 * Parse `reviewContext.turns`, falling back to the legacy single-turn shape
 * (`assistantText` + top-level `toolRuns`) for older clients.
 */
export function collectReviewTurns(
  reviewContext: ChatReviewContext | null | undefined,
  priorText: string,
): ReviewTurn[] {
  const rawTurns = Array.isArray(reviewContext?.turns) ? reviewContext!.turns! : [];
  const turns: ReviewTurn[] = rawTurns
    .map((t) => ({
      messageId: String(t?.messageId || '').trim(),
      assistantText: String(t?.assistantText || '').trim(),
      toolRuns: t?.toolRuns,
    }))
    .filter((t) => t.messageId && t.assistantText);
  if (!turns.length && priorText) {
    turns.push({
      messageId: String(reviewContext?.targetMessageId || '').trim() || 'last',
      assistantText: priorText,
      toolRuns: reviewContext?.toolRuns,
    });
  }
  return turns;
}

export type ReviewAuditOpts = {
  searchEnabled: boolean;
  integrations: string[];
  skillCreator?: boolean;
};

/**
 * Run the full claim audit over each reviewed turn (spending the LLM
 * verifier on the focused turn, or any earlier turn whose local heuristics
 * already found an error), merging findings/issues across turns. Emits an
 * empty report when there is nothing to review.
 */
export async function auditReviewTurns(opts: {
  turns: ReviewTurn[];
  targetMessageId?: string;
  auditOpts: ReviewAuditOpts;
  userAsk: string;
  signal?: AbortSignal;
  send: (payload: Record<string, unknown>) => void;
  verifierComplete: LlmCompleteFn;
}): Promise<{ findings: ReviewFinding[]; issues: ReviewIssue[] }> {
  const { turns } = opts;
  if (!turns.length) {
    emitReviewReport(
      opts.send,
      buildReviewReport({ assistantText: '', record: [], findings: [], phase: 'requested' }),
      opts.targetMessageId,
    );
    return { findings: [], issues: [] };
  }

  const focusId = String(opts.targetMessageId || '').trim() || turns[turns.length - 1]!.messageId;
  let findings: ReviewFinding[] = [];
  let issues: ReviewIssue[] = [];
  for (const turn of turns) {
    const priorRecord = buildExecutionRecordFromToolRuns(turn.toolRuns || []);
    const earlyErrors = synthesizeFindings(turn.assistantText, priorRecord, opts.auditOpts).some(
      (f) => f.severity === 'error',
    );
    const audit = await runFullClaimAudit(
      opts.send,
      turn.assistantText,
      priorRecord,
      opts.auditOpts,
      'requested',
      opts.verifierComplete,
      {
        forceLlm: turn.messageId === focusId || earlyErrors,
        targetMessageId: turn.messageId,
        emitEmpty: true,
        userAsk: opts.userAsk,
        signal: opts.signal,
      },
    );
    findings = findings.concat(audit.findings);
    issues = issues.concat(audit.issues);
  }
  return { findings, issues };
}

/** Build the system+user prompt for the dedicated (tools-off) review answer. */
export function buildReviewAnswerMessages(opts: {
  findings: ReviewFinding[];
  issues: ReviewIssue[];
  priorText: string;
  turns: ReviewTurn[];
}): Array<{ role: string; content: string }> {
  const fallbackText = opts.priorText || opts.turns.map((t) => t.assistantText).join('\n\n');
  return [
    { role: 'system', content: FINDINGS_RESPONSE_SYSTEM },
    {
      role: 'user',
      content: opts.issues.length
        ? buildReviewIssuesResponsePrompt(opts.issues, fallbackText)
        : buildFindingsResponsePrompt(opts.findings, fallbackText),
    },
  ];
}
