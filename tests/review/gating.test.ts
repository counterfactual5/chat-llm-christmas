import { describe, expect, it } from 'vitest';
import {
  actionableReviewIssues,
  buildReviewIssuesResponsePrompt,
  buildVerifierSystemPrompt,
  detectDegenerateOutput,
} from '@/lib/tools/review/claim-reviewer';
import type { ReviewIssue } from '@/lib/tools/review/claim-reviewer';

function issue(
  kind: ReviewIssue['kind'],
  title: string,
  detail: string,
  extra?: Pick<ReviewIssue, 'ruleId' | 'verdict' | 'evidenceStrength'>,
): ReviewIssue {
  return { kind, severity: 'error', title, detail, ...extra };
}

describe('review correction gating', () => {
  it('keeps low-confidence semantic heuristics advisory', () => {
    const issues = [
      issue('citation', 'Link missing', 'This URL never appeared in retrieval results.', {
        ruleId: 'citation:missing_url',
      }),
      issue('staleness', 'Newest source is from 2024', 'Sources may be stale.', {
        ruleId: 'staleness:newest_source',
      }),
      issue('consistency', 'Different values', 'The same metric may conflict.'),
      issue('code_quality', 'Empty catch block', 'A warning-level code smell.', {
        ruleId: 'empty-catch',
      }),
      issue(
        'citation',
        'Unverified figure',
        '[unverifiable/weak] Blurb miss is not proof.',
        { ruleId: 'citation:unverifiable:weak', verdict: 'unverifiable', evidenceStrength: 'weak' },
      ),
    ];

    expect(actionableReviewIssues(issues)).toEqual([]);
  });

  it('never auto-corrects mid_turn (already injected live)', () => {
    const issues = [
      issue('mid_turn', 'web_search', 'Stopped after announcing intent; reviewer forced another tool round.', {
        ruleId: 'mid_turn:intent',
      }),
    ];
    expect(actionableReviewIssues(issues)).toEqual([]);
  });

  it('auto-corrects high-confidence evidence, freshness, code, and security errors by ruleId', () => {
    const issues = [
      issue(
        'citation',
        'Unsupported figure',
        '[unsupported/strong] Cited page body does not contain 42%.',
        {
          ruleId: 'citation:unsupported:strong',
          verdict: 'unsupported',
          evidenceStrength: 'strong',
        },
      ),
      issue('staleness', 'Dated "as of 2023" but now is 2026', 'The claim is 3 years behind.', {
        ruleId: 'staleness:dated_cutoff',
      }),
      issue('code_quality', 'Off-by-one loop bound', '`<= length` runs past the last index.', {
        ruleId: 'off-by-one',
      }),
      issue('code_quality', 'Mutable default argument', 'Python evaluates defaults once.', {
        ruleId: 'mutable-default-arg',
      }),
      issue('vulnerability', 'SQL built by string interpolation', 'Use parameterized queries.', {
        ruleId: 'sql-injection',
      }),
    ];

    expect(actionableReviewIssues(issues)).toHaveLength(5);
  });

  it('ignores forged free-text that looks actionable without a stable ruleId', () => {
    const issues = [
      issue(
        'citation',
        'Unsupported figure',
        '[unsupported/strong] Cited page body does not contain 42%.',
      ),
      issue('completeness', 'Answer was cut off', 'Generation hit the token limit.'),
      issue('vulnerability', 'SQL built by string interpolation', 'Use parameterized queries.'),
      issue('code_quality', 'Off-by-one loop bound', '`<= length` runs past the last index.'),
    ];
    expect(actionableReviewIssues(issues)).toEqual([]);
  });

  it('auto-corrects pending_intent, no_receipt, arithmetic, and structural failures', () => {
    const issues = [
      issue(
        'tool_receipt',
        'Announced web_search but emitted no tool_calls',
        'No tools ran this turn.',
        { ruleId: 'tool_receipt:pending_intent', verdict: 'pending_intent' },
      ),
      issue(
        'tool_receipt',
        'Claimed Notion write without a matching successful tool receipt',
        'No successful notion receipt.',
        { ruleId: 'tool_receipt:no_receipt', verdict: 'no_receipt' },
      ),
      issue('recalculation', '2 + 2 = 5', 'Verified as 4 (answer said 5)', {
        ruleId: 'recalculation:inline_mismatch',
      }),
      issue('completeness', 'Unclosed code block', 'A ``` fence was opened and never closed.', {
        ruleId: 'completeness:unclosed_fence',
      }),
      issue(
        'completeness',
        'Answer collapsed into garbage',
        'Output collapsed into a long repeated "─" run.',
        { ruleId: 'completeness:degenerate' },
      ),
    ];

    expect(actionableReviewIssues(issues)).toHaveLength(5);
  });

  it('builds actionable correction instructions for review issue types', () => {
    const prompt = buildReviewIssuesResponsePrompt(
      [
        issue(
          'citation',
          'Unsupported figure',
          '[unsupported/strong] Full-page evidence does not contain 42%.',
          {
            ruleId: 'citation:unsupported:strong',
            verdict: 'unsupported',
            evidenceStrength: 'strong',
          },
        ),
        issue('staleness', 'Dated "as of 2023" but now is 2026', 'The claim is 3 years behind.', {
          ruleId: 'staleness:dated_cutoff',
        }),
        issue('code_quality', 'Off-by-one loop bound', '`<= length` runs past the last index.', {
          ruleId: 'off-by-one',
        }),
        issue('vulnerability', 'SQL built by string interpolation', 'Use parameterized queries.', {
          ruleId: 'sql-injection',
        }),
      ],
      '```ts\nfor (let i = 0; i <= items.length; i++) console.log(items[i]);\n```',
    );

    expect(prompt).toContain('Retract or narrow claims');
    expect(prompt).toContain('Correct the time framing');
    expect(prompt).toContain('minimal corrected code fragment');
    expect(prompt).toContain('minimal safer replacement');
  });

  it('asks for a replacement diagram and includes the damaged section', () => {
    const brokenDiagram =
      '┌────────────────────────────────────────────────────────────┐ │ Application │ └────────────────────────────────────────────────────────────┘';
    const prompt = buildReviewIssuesResponsePrompt(
      [
        issue(
          'completeness',
          'Answer collapsed into garbage',
          'Output collapsed into a long repeated "─" run.',
          { ruleId: 'completeness:degenerate' },
        ),
      ],
      `${'Earlier valid explanation. '.repeat(80)}\nSimple summary: ${brokenDiagram}`,
    );

    expect(prompt).toContain('Replace the malformed diagram/section');
    expect(prompt).toContain('fenced `text` block');
    expect(prompt).toContain('valid Mermaid diagram');
    expect(prompt).toContain('Application');
  });

  it('omits leaked credential text from the correction-model excerpt', () => {
    const leaked = `API key: sk-${'a'.repeat(32)}`;
    const prompt = buildReviewIssuesResponsePrompt(
      [
        issue('vulnerability', 'API secret key (sk-…)', 'Token-like secret in plaintext.', {
          ruleId: 'openai-key',
        }),
      ],
      leaked,
    );

    expect(prompt).not.toContain(leaked);
    expect(prompt).toContain('Sensitive original excerpt omitted');
    expect(prompt).toContain('revoke/rotate');
  });

  it('does not flag a correctly fenced ASCII diagram as model collapse', () => {
    const diagram = [
      '```text',
      '┌────────────────────────────────────────────────────────────┐',
      '│ Application                                                │',
      '└────────────────────────────────────────────────────────────┘',
      '```',
    ].join('\n');

    expect(detectDegenerateOutput(diagram)).toBeNull();
  });

  it('flags a flattened inline ASCII diagram as model collapse', () => {
    const broken =
      'Summary: ┌────────────────────────────────────────────────────────────┐ │ Application │ └────────────────────────────────────────────────────────────┘';

    expect(detectDegenerateOutput(broken)).toContain('long repeated');
  });

  it('tells the LLM verifier to prefer ambiguity tolerance', () => {
    const prompt = buildVerifierSystemPrompt(['tool_receipt']);
    expect(prompt).toContain('NEVER treat tutorials');
    expect(prompt).toContain('If semantic intent is ambiguous, return no finding.');
  });
});
