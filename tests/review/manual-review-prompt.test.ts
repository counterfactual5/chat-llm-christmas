import { describe, expect, it } from 'vitest';
import {
  buildManualReviewResponsePrompt,
  extractManualReviewFocus,
  MANUAL_REVIEW_RESPONSE_SYSTEM,
} from '@/lib/tools/review/claim-reviewer';

describe('manual review response prompts', () => {
  it('extracts focus from the claim-review user payload', () => {
    expect(
      extractManualReviewFocus(
        [
          'Claim Review: audit…',
          '',
          'Additional review focus from the user (prioritize these concerns):',
          '感觉时效性对不上',
        ].join('\n'),
      ),
    ).toBe('感觉时效性对不上');
  });

  it('asks for a structured report and preserves user focus', () => {
    expect(MANUAL_REVIEW_RESPONSE_SYSTEM).toContain('structured Markdown report');
    expect(MANUAL_REVIEW_RESPONSE_SYSTEM).toContain('thorough');
    expect(MANUAL_REVIEW_RESPONSE_SYSTEM).toContain('Unlike Auto-review');

    const prompt = buildManualReviewResponsePrompt({
      issues: [
        {
          kind: 'citation',
          severity: 'error',
          title: 'Link not in tool results',
          detail: 'URL never appeared',
        },
        {
          kind: 'staleness',
          severity: 'warn',
          title: 'Newest source is old',
          detail: 'Sources may be stale',
        },
      ],
      findings: [],
      assistantText: 'prior answer with many links',
      userAsk: [
        'Claim Review…',
        'Additional review focus from the user (prioritize these concerns):',
        '感觉时效性对不上啊',
      ].join('\n'),
    });

    expect(prompt).toContain('User focus');
    expect(prompt).toContain('感觉时效性对不上啊');
    expect(prompt).toContain('Review issues');
    expect(prompt).toContain('timeliness');
    expect(prompt).not.toContain('under 120 words');
    expect(prompt).not.toContain('SHORT annotation');
  });
});
