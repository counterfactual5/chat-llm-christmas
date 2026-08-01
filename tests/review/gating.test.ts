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
): ReviewIssue {
  return { kind, severity: 'error', title, detail };
}

describe('review correction gating', () => {
  it('keeps low-confidence semantic heuristics advisory', () => {
    const issues = [
      issue('citation', 'Link missing', 'This URL never appeared in retrieval results.'),
      issue('staleness', 'Newest source is from 2024', 'Sources may be stale.'),
      issue('consistency', 'Different values', 'The same metric may conflict.'),
      issue('code_quality', 'Empty catch block', 'A warning-level code smell.'),
    ];

    expect(actionableReviewIssues(issues)).toEqual([]);
  });

  it('auto-corrects high-confidence evidence, freshness, code, and security errors', () => {
    const issues = [
      issue(
        'citation',
        'Unsupported figure',
        '[unsupported/strong] Cited page body does not contain 42%.',
      ),
      issue('staleness', 'Dated "as of 2023" but now is 2026', 'The claim is 3 years behind.'),
      issue('code_quality', 'Off-by-one loop bound', '`<= length` runs past the last index.'),
      issue('code_quality', 'Mutable default argument', 'Python evaluates defaults once.'),
      issue('vulnerability', 'SQL built by string interpolation', 'Use parameterized queries.'),
    ];

    expect(actionableReviewIssues(issues)).toHaveLength(5);
  });

  it('still auto-corrects concrete receipts, arithmetic, and structural failures', () => {
    const issues = [
      issue('tool_receipt', 'Notion write', 'Claimed success without a matching successful tool receipt.'),
      issue('recalculation', '2 + 2 = 5', 'Verified as 4 (answer said 5)'),
      issue('completeness', 'Unclosed code block', 'A ``` fence was opened and never closed.'),
      issue(
        'completeness',
        'Answer collapsed into garbage',
        'Output collapsed into a long repeated "─" run.',
      ),
    ];

    expect(actionableReviewIssues(issues)).toHaveLength(4);
  });

  it('builds actionable correction instructions for review issue types', () => {
    const prompt = buildReviewIssuesResponsePrompt(
      [
        issue(
          'citation',
          'Unsupported figure',
          '[unsupported/strong] Full-page evidence does not contain 42%.',
        ),
        issue('staleness', 'Dated "as of 2023" but now is 2026', 'The claim is 3 years behind.'),
        issue('code_quality', 'Off-by-one loop bound', '`<= length` runs past the last index.'),
        issue('vulnerability', 'SQL built by string interpolation', 'Use parameterized queries.'),
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
      [issue('vulnerability', 'API secret key (sk-…)', 'Token-like secret in plaintext.')],
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
