import { describe, expect, it } from 'vitest';
import { planReviewChecks } from '@/lib/tools/review/core/report';
import type { ReviewInput } from '@/lib/tools/review/core/types';

function baseInput(phase: ReviewInput['phase']): ReviewInput {
  return {
    assistantText:
      'See https://eleduck.com and https://cn.indeed.com and https://t.me/DeJob_official for jobs.',
    record: [
      {
        tool: 'web_search',
        ok: true,
        query: 'web3 jobs',
        urls: ['https://learnblockchain.cn/jobs'],
        sources: [
          {
            title: 'jobs',
            url: 'https://learnblockchain.cn/jobs',
            snippet: 'jobs list',
          },
        ],
      },
    ],
    findings: [],
    phase,
  };
}

describe('planReviewChecks LLM policy', () => {
  it('keeps auto-review local-only even with several citation warns', () => {
    const plan = planReviewChecks(baseInput('audit'));
    // Local citation check may or may not fire depending on URL pickup; the
    // contract under test is that auto-review never schedules an LLM pass.
    expect(plan.llm).toBe(false);
    expect(plan.lenses).toEqual([]);
    expect(plan.reason).toMatch(/local checks only/i);
  });

  it('spends LLM deep pass only for manual /review', () => {
    const plan = planReviewChecks(baseInput('requested'));
    expect(plan.llm).toBe(true);
    expect(plan.lenses.length).toBeGreaterThan(0);
    expect(plan.reason).toMatch(/user requested/i);
  });

  it('does not spend LLM on auto-review for heuristic findings or mid-turn', () => {
    const withFindings = planReviewChecks({
      ...baseInput('audit'),
      findings: [
        {
          id: '1',
          severity: 'error',
          surface: 'web_search',
          verdict: 'no_receipt',
          claim: 'I searched',
          evidence: 'none',
        },
      ],
    });
    expect(withFindings.llm).toBe(false);

    const withMid = planReviewChecks({
      ...baseInput('audit'),
      midTurn: { surfaces: ['web_search'], kind: 'pending_intent' },
    });
    expect(withMid.llm).toBe(false);
  });
});
