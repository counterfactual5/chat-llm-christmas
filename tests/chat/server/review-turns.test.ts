import { beforeEach, describe, expect, it, vi } from 'vitest';

const claimReviewerMocks = vi.hoisted(() => ({
  buildExecutionRecordFromToolRuns: vi.fn((toolRuns: any[]) =>
    (toolRuns || []).map((r) => ({ tool: r?.name })),
  ),
  buildManualReviewResponsePrompt: vi.fn(
    (opts: { issues?: any[]; findings?: any[]; assistantText?: string; userAsk?: string }) =>
      `manual:${opts.issues?.length || 0}:${opts.findings?.length || 0}:${opts.assistantText || ''}:${opts.userAsk || ''}`,
  ),
  buildReviewReport: vi.fn((input: any) => ({ phase: input.phase, status: 'done', checks: [] })),
  emitReviewReport: vi.fn(),
  emitReviewProcessCard: vi.fn(
    (
      send: (payload: Record<string, unknown>) => void,
      opts: {
        name: string;
        status: 'start' | 'done';
        query: string;
        error?: string;
        results?: Array<{ title: string; url: string; snippet: string }>;
      },
    ) => {
      send({
        tool: {
          name: opts.name,
          status: opts.status,
          provider: 'review',
          query: opts.query,
          ...(opts.error ? { error: opts.error } : {}),
          ...(opts.results ? { results: opts.results } : {}),
        },
      });
    },
  ),
  reviewProcessErrorMessage: vi.fn((err: unknown, fallback = 'Review failed') => {
    if (err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError') {
      return 'Review aborted';
    }
    return err instanceof Error && err.message ? err.message : fallback;
  }),
  runFullClaimAudit: vi.fn(),
  synthesizeFindings: vi.fn((_text?: string) => [] as Array<{ severity: string }>),
  MANUAL_REVIEW_RESPONSE_SYSTEM: 'MANUAL_REVIEW_RESPONSE_SYSTEM',
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
  it('uses the manual review prompt with prior text and userAsk', () => {
    const messages = buildReviewAnswerMessages({
      findings: [{ id: 'f1' } as any],
      issues: [{ kind: 'citation' } as any],
      priorText: 'the prior answer',
      turns: [{ messageId: 'm1', assistantText: 'turn text' }],
      userAsk: 'Claim Review…\nAdditional review focus from the user (prioritize these concerns):\n时效性',
    });

    expect(messages).toEqual([
      { role: 'system', content: 'MANUAL_REVIEW_RESPONSE_SYSTEM' },
      {
        role: 'user',
        content:
          'manual:1:1:the prior answer:Claim Review…\nAdditional review focus from the user (prioritize these concerns):\n时效性',
      },
    ]);
  });

  it('falls back to joined turn text when priorText is empty', () => {
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
      content: 'manual:0:1:turn one\n\nturn two:',
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

    // Deep-Research-style Process card per audited turn: one start + one done.
    const toolSends = send.mock.calls.map((call) => call[0]?.tool).filter(Boolean);
    expect(toolSends.filter((tool) => tool.name === 'claim_audit' && tool.status === 'start')).toHaveLength(
      3,
    );
    expect(toolSends.filter((tool) => tool.name === 'claim_audit' && tool.status === 'done')).toHaveLength(
      3,
    );
    expect(toolSends.every((tool) => tool.provider === 'review')).toBe(true);
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

  it('closes claim_audit with error when the audit throws', async () => {
    const abortErr = new Error('stopped');
    abortErr.name = 'AbortError';
    claimReviewerMocks.runFullClaimAudit.mockRejectedValue(abortErr);

    const send = vi.fn();
    await expect(
      auditReviewTurns({
        turns: [{ messageId: 'm1', assistantText: 'a' }],
        auditOpts: { searchEnabled: false, integrations: [] },
        userAsk: '',
        send,
        verifierComplete: vi.fn(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    const toolSends = send.mock.calls.map((call) => call[0]?.tool).filter(Boolean);
    expect(toolSends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'claim_audit',
          status: 'start',
          provider: 'review',
        }),
        expect.objectContaining({
          name: 'claim_audit',
          status: 'done',
          provider: 'review',
          error: 'Review aborted',
        }),
      ]),
    );
  });
});
