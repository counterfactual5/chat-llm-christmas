import { beforeEach, describe, expect, it, vi } from 'vitest';

const claimReviewerMocks = vi.hoisted(() => ({
  buildExecutionRecordFromToolRuns: vi.fn((toolRuns: any[]) =>
    (toolRuns || []).map((r) => ({ tool: r?.name })),
  ),
  buildFindingsResponsePrompt: vi.fn(
    (findings: any[], text?: string) => `findings:${findings.length}:${text}`,
  ),
  buildReviewIssuesResponsePrompt: vi.fn(
    (issues: any[], text?: string) => `issues:${issues.length}:${text}`,
  ),
  buildReviewReport: vi.fn((input: any) => ({ phase: input.phase, status: 'done', checks: [] })),
  emitReviewReport: vi.fn(),
  runFullClaimAudit: vi.fn(),
  synthesizeFindings: vi.fn((_text?: string) => [] as Array<{ severity: string }>),
  FINDINGS_RESPONSE_SYSTEM: 'FINDINGS_RESPONSE_SYSTEM',
}));

vi.mock('@/lib/tools/review/claim-reviewer', () => claimReviewerMocks);

import {
  auditReviewTurns,
  buildReviewAnswerMessages,
  collectReviewTurns,
} from '@/lib/chat/server/review-turns';

describe('collectReviewTurns', () => {
  it('parses and trims full-thread turns, dropping incomplete ones', () => {
    const turns = collectReviewTurns(
      {
        turns: [
          { messageId: ' m1 ', assistantText: ' hello ', toolRuns: [{ name: 'web_search', status: 'done' }] },
          { messageId: '', assistantText: 'no id' },
          { messageId: 'm3', assistantText: '   ' },
        ],
      } as any,
      '',
    );

    expect(turns).toEqual([
      {
        messageId: 'm1',
        assistantText: 'hello',
        toolRuns: [{ name: 'web_search', status: 'done' }],
      },
    ]);
  });

  it('falls back to the legacy single-turn shape when there are no turns', () => {
    const turns = collectReviewTurns(
      { targetMessageId: 'target-1', toolRuns: [{ name: 'notion_write', status: 'done' }] } as any,
      'prior assistant answer',
    );

    expect(turns).toEqual([
      {
        messageId: 'target-1',
        assistantText: 'prior assistant answer',
        toolRuns: [{ name: 'notion_write', status: 'done' }],
      },
    ]);
  });

  it('defaults the legacy fallback messageId to "last" when no target id is given', () => {
    const turns = collectReviewTurns(null, 'prior answer');
    expect(turns[0]?.messageId).toBe('last');
  });

  it('returns no turns when there is nothing to review', () => {
    expect(collectReviewTurns(null, '')).toEqual([]);
    expect(collectReviewTurns({ turns: [] } as any, '')).toEqual([]);
  });
});

describe('buildReviewAnswerMessages', () => {
  it('uses the issues prompt (and prior text) when issues were found', () => {
    const messages = buildReviewAnswerMessages({
      findings: [{ id: 'f1' } as any],
      issues: [{ kind: 'citation' } as any],
      priorText: 'the prior answer',
      turns: [{ messageId: 'm1', assistantText: 'turn text' }],
    });

    expect(messages).toEqual([
      { role: 'system', content: 'FINDINGS_RESPONSE_SYSTEM' },
      { role: 'user', content: 'issues:1:the prior answer' },
    ]);
  });

  it('falls back to the findings prompt using joined turn text when priorText is empty', () => {
    const messages = buildReviewAnswerMessages({
      findings: [{ id: 'f1' } as any],
      issues: [],
      priorText: '',
      turns: [
        { messageId: 'm1', assistantText: 'turn one' },
        { messageId: 'm2', assistantText: 'turn two' },
      ],
    });

    expect(messages[1]).toEqual({
      role: 'user',
      content: 'findings:1:turn one\n\nturn two',
    });
  });
});

describe('auditReviewTurns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claimReviewerMocks.buildReviewReport.mockImplementation((input: any) => ({
      phase: input.phase,
      status: 'done',
      checks: [],
    }));
    claimReviewerMocks.buildExecutionRecordFromToolRuns.mockImplementation((toolRuns: any[]) =>
      (toolRuns || []).map((r) => ({ tool: r?.name })),
    );
  });

  it('emits an empty report and skips the audit when there are no turns', async () => {
    const send = vi.fn();
    const result = await auditReviewTurns({
      turns: [],
      targetMessageId: 'target-1',
      auditOpts: { searchEnabled: true, integrations: [] },
      userAsk: 'what happened?',
      send,
      verifierComplete: vi.fn(),
    });

    expect(result).toEqual({ findings: [], issues: [] });
    expect(claimReviewerMocks.runFullClaimAudit).not.toHaveBeenCalled();
    expect(claimReviewerMocks.emitReviewReport).toHaveBeenCalledWith(
      send,
      { phase: 'requested', status: 'done', checks: [] },
      'target-1',
    );
  });

  it('forces the LLM verifier only on the focused turn or turns with early local errors', async () => {
    claimReviewerMocks.synthesizeFindings.mockImplementation((text?: string) =>
      text === 'turn-with-error' ? [{ severity: 'error' }] : [],
    );
    claimReviewerMocks.runFullClaimAudit.mockImplementation((_send, text: string) => ({
      findings: [{ id: `finding-${text}` }],
      issues: [{ kind: `issue-${text}` }],
      report: { phase: 'requested', status: 'done', checks: [] },
    }));

    const send = vi.fn();
    const verifierComplete = vi.fn();
    const result = await auditReviewTurns({
      turns: [
        { messageId: 'm1', assistantText: 'turn-with-error', toolRuns: [] },
        { messageId: 'm2', assistantText: 'turn-clean', toolRuns: [] },
        { messageId: 'm3', assistantText: 'turn-focus', toolRuns: [] },
      ],
      targetMessageId: 'm3',
      auditOpts: { searchEnabled: true, integrations: ['notion'] },
      userAsk: 'ask',
      send,
      verifierComplete,
    });

    expect(claimReviewerMocks.runFullClaimAudit).toHaveBeenCalledTimes(3);
    const forceLlmFlags = claimReviewerMocks.runFullClaimAudit.mock.calls.map(
      (call) => call[6].forceLlm,
    );
    expect(forceLlmFlags).toEqual([true, false, true]);

    expect(result.findings).toEqual([
      { id: 'finding-turn-with-error' },
      { id: 'finding-turn-clean' },
      { id: 'finding-turn-focus' },
    ]);
    expect(result.issues).toEqual([
      { kind: 'issue-turn-with-error' },
      { kind: 'issue-turn-clean' },
      { kind: 'issue-turn-focus' },
    ]);
  });

  it('defaults the focus turn to the last turn when no targetMessageId is given', async () => {
    claimReviewerMocks.runFullClaimAudit.mockResolvedValue({
      findings: [],
      issues: [],
      report: { phase: 'requested', status: 'done', checks: [] },
    });

    await auditReviewTurns({
      turns: [
        { messageId: 'm1', assistantText: 'a' },
        { messageId: 'm2', assistantText: 'b' },
      ],
      auditOpts: { searchEnabled: false, integrations: [] },
      userAsk: '',
      send: vi.fn(),
      verifierComplete: vi.fn(),
    });

    const forceLlmFlags = claimReviewerMocks.runFullClaimAudit.mock.calls.map(
      (call) => call[6].forceLlm,
    );
    expect(forceLlmFlags).toEqual([false, true]);
  });
});
