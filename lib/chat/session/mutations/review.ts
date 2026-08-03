/**
 * Review report / findings upserts and tool-run serialization for claim review.
 */

import { mergeReviewChecks, type ReviewCheck } from '@/lib/tools/review/claim-reviewer';
import type { ChatSession, Message } from '@/lib/chat/types';
import { touchSession } from '@/lib/chat/session/mutations/shared';

export function withUpsertedReviewReport(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  report: Message['reviewReport'],
): ChatSession[] {
  if (!report) return sessions;
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    return touchSession(s, {
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m;
        const prevChecks = m.reviewReport?.checks || [];
        const mergedChecks = mergeReviewChecks(
          prevChecks as ReviewCheck[],
          report.checks as ReviewCheck[],
        );
        if (!mergedChecks.length) return m;
        const merged: NonNullable<Message['reviewReport']> = {
          ...report,
          checks: mergedChecks,
        };
        const toolReceipt = merged.checks.find((c) => c.kind === 'tool_receipt');
        const legacyFindings =
          toolReceipt?.items?.map((item, i) => ({
            id: item.ruleId || `tool_receipt:${i}`,
            severity: item.severity,
            surface: item.surface || 'tool',
            verdict: item.verdict || 'no_receipt',
            claim: item.title,
            evidence: item.detail,
          })) || [];
        return {
          ...m,
          reviewReport: merged,
          ...(merged.status === 'done' ? { reviewFindings: legacyFindings } : {}),
        };
      }),
    });
  });
}

export function withUpsertedReviewFindings(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  payload: {
    findings: Message['reviewFindings'];
    /** Allow clearing / recording a clean review. */
    allowEmpty?: boolean;
  },
): ChatSession[] {
  if (!payload.findings?.length && !payload.allowEmpty) return sessions;
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    return touchSession(s, {
      messages: s.messages.map((m) =>
        m.id === assistantId ? { ...m, reviewFindings: payload.findings || [] } : m,
      ),
    });
  });
}

export function serializeReviewToolRuns(
  runs: NonNullable<Message['toolRuns']> | undefined,
) {
  return (runs || []).map((r) => ({
    name: r.name,
    status: r.status,
    query: r.query,
    error: r.error,
    provider: r.provider,
    results: (r.results || [])
      .filter((x) => x?.url || x?.snippet || x?.body)
      .slice(0, 20)
      .map((x) => ({
        url: x.url,
        title: x.title,
        snippet: x.snippet,
        ...(x.body ? { body: String(x.body).slice(0, 16_000) } : {}),
      })),
  }));
}

