import { describe, expect, it } from 'vitest';
import {
  actionableReviewIssues,
  buildVerifierSystemPrompt,
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
  it('keeps semantic heuristics advisory instead of auto-rewriting the answer', () => {
    const issues = [
      issue('citation', 'Figure missing', 'Full-page evidence does not contain 42%.'),
      issue('staleness', 'Dated claim', 'The claim may be two years behind.'),
      issue('consistency', 'Different values', 'The same metric may conflict.'),
      issue('code_quality', 'Off-by-one', 'A heuristic found <= length.'),
    ];

    expect(actionableReviewIssues(issues)).toEqual([]);
  });

  it('still auto-corrects concrete receipts, arithmetic, and structural failures', () => {
    const issues = [
      issue('tool_receipt', 'Notion write', 'Claimed success without a matching successful tool receipt.'),
      issue('recalculation', '2 + 2 = 5', 'Verified as 4 (answer said 5)'),
      issue('completeness', 'Unclosed code block', 'A ``` fence was opened and never closed.'),
    ];

    expect(actionableReviewIssues(issues)).toHaveLength(3);
  });

  it('tells the LLM verifier to prefer ambiguity tolerance', () => {
    const prompt = buildVerifierSystemPrompt(['tool_receipt']);
    expect(prompt).toContain('NEVER treat tutorials');
    expect(prompt).toContain('If semantic intent is ambiguous, return no finding.');
  });
});
