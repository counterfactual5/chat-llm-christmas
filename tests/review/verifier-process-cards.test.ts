import { describe, expect, it, vi } from 'vitest';
import { runFullClaimAudit } from '@/lib/tools/review/core/verifier';

/**
 * Manual `/review` gets a Deep-Research-style Process card around the LLM
 * verifier call; Auto-review (runs after every turn) must stay silent here —
 * it already has its own short-correction UI.
 */
describe('runFullClaimAudit — claim_verifier Process card', () => {
  it('emits a claim_verifier start/done tool card for manual review (phase=requested)', async () => {
    const send = vi.fn();
    const complete = vi.fn().mockResolvedValue('{"findings":[],"summary":"clean"}');

    await runFullClaimAudit(
      send,
      'The assistant answer text.',
      [],
      { searchEnabled: false, integrations: [] },
      'requested',
      complete,
      { forceLlm: true, emitEmpty: true },
    );

    const toolSends = send.mock.calls.map((call) => call[0]?.tool).filter(Boolean);
    expect(
      toolSends.some(
        (tool) => tool.name === 'claim_verifier' && tool.status === 'start' && tool.provider === 'review',
      ),
    ).toBe(true);
    expect(
      toolSends.some(
        (tool) => tool.name === 'claim_verifier' && tool.status === 'done' && tool.provider === 'review',
      ),
    ).toBe(true);
  });

  it('stays silent for auto-review (phase=audit) — no Process card on every turn', async () => {
    const send = vi.fn();
    const complete = vi.fn().mockResolvedValue('{"findings":[],"summary":"clean"}');

    await runFullClaimAudit(
      send,
      'The assistant answer text.',
      [],
      { searchEnabled: false, integrations: [] },
      'audit',
      complete,
      { forceLlm: true, emitEmpty: true },
    );

    const toolSends = send.mock.calls.map((call) => call[0]?.tool).filter(Boolean);
    expect(toolSends.some((tool) => tool.name === 'claim_verifier')).toBe(false);
  });

  it('closes claim_verifier with error when the verifier aborts', async () => {
    const send = vi.fn();
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const complete = vi.fn().mockRejectedValue(abortErr);

    await expect(
      runFullClaimAudit(
        send,
        'The assistant answer text.',
        [],
        { searchEnabled: false, integrations: [] },
        'requested',
        complete,
        { forceLlm: true, emitEmpty: true },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    const toolSends = send.mock.calls.map((call) => call[0]?.tool).filter(Boolean);
    const failed = toolSends.find(
      (tool) => tool.name === 'claim_verifier' && tool.status === 'done',
    );
    expect(failed?.error).toBe('Review aborted');
  });
});
