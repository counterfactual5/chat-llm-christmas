/**
 * Request Review orchestration: turn a client-supplied `reviewContext` into
 * per-turn claim audits, then build the prompt for the dedicated (tools-off)
 * answer that addresses whatever the audits found.
 */

import type { ChatReviewContext, ChatReviewToolRun } from '@/lib/chat/server/request';
import {
  buildExecutionRecordFromToolRuns,
  buildManualReviewResponsePrompt,
  buildReviewReport,
  emitReviewProcessCard,
  emitReviewReport,
  reviewProcessErrorMessage,
  runFullClaimAudit,
  synthesizeFindings,
  MANUAL_REVIEW_RESPONSE_SYSTEM,
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
 * already found an error; other turns stay local-only even though
 * phase=requested would otherwise deep-pass every turn). Merges
 * findings/issues across turns. Emits an empty report when there is nothing
 * to review.
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
  const total = turns.length;
  for (let i = 0; i < total; i++) {
    const turn = turns[i]!;
    // Multi-turn /review audits each reviewed turn in sequence — surface it as
    // a Process card per turn (Deep Research style) so progress is visible
    // instead of one silent wait behind the Thought panel.
    const turnLabel = total > 1 ? `Turn ${i + 1}/${total} — ${turn.messageId}` : 'Audit target reply';
    emitReviewProcessCard(opts.send, {
      name: 'claim_audit',
      status: 'start',
      query: turnLabel,
    });
    try {
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
      emitReviewProcessCard(opts.send, {
        name: 'claim_audit',
        status: 'done',
        query: turnLabel,
        results: [
          {
            title: 'Audit result',
            url: '',
            snippet: `${audit.findings.length} tool-claim finding(s) · ${audit.issues.length} other issue(s)`,
          },
        ],
      });
      findings = findings.concat(
        audit.findings.map((f) => {
          if (total <= 1) return f;
          const claim = String(f.claim || '').trim();
          return {
            ...f,
            claim: claim ? `[${turn.messageId}] ${claim}` : `[${turn.messageId}]`,
          };
        }),
      );
      issues = issues.concat(
        audit.issues.map((issue) => {
          const tagged = { ...issue, sourceMessageId: turn.messageId };
          if (total <= 1) return tagged;
          const title = String(issue.title || '').trim();
          return {
            ...tagged,
            title: title ? `[${turn.messageId}] ${title}` : `[${turn.messageId}]`,
          };
        }),
      );
    } catch (err) {
      emitReviewProcessCard(opts.send, {
        name: 'claim_audit',
        status: 'done',
        query: turnLabel,
        error: reviewProcessErrorMessage(err, 'Claim audit failed'),
      });
      throw err;
    }
  }
  return { findings, issues };
}

/** Build the system+user prompt for the dedicated (tools-off) manual review answer. */
export function buildReviewAnswerMessages(opts: {
  findings: ReviewFinding[];
  issues: ReviewIssue[];
  priorText: string;
  turns: ReviewTurn[];
  userAsk?: string;
}): Array<{ role: string; content: string }> {
  const fallbackText = opts.priorText || opts.turns.map((t) => t.assistantText).join('\n\n');
  return [
    { role: 'system', content: MANUAL_REVIEW_RESPONSE_SYSTEM },
    {
      role: 'user',
      content: buildManualReviewResponsePrompt({
        issues: opts.issues,
        findings: opts.findings,
        assistantText: fallbackText,
        userAsk: opts.userAsk,
      }),
    },
  ];
}
