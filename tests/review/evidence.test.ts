import { describe, expect, it } from 'vitest';
import {
  buildEvidenceIndex,
  collectEvidenceUnits,
  extractEvidenceFromPayload,
  factAppearsIn,
  gradeClaimGap,
  strongestFor,
} from '@/lib/tools/review/core/evidence';

describe('review evidence', () => {
  it('normalizes currency and thousands separators when matching facts', () => {
    expect(factAppearsIn('$64,000', 'The reported price was USD 64000.')).toBe(true);
    expect(factAppearsIn('64000', 'The reported price was 63,000.')).toBe(false);
  });

  it('extracts strong body evidence from a web reader payload', () => {
    const body = 'Evidence '.repeat(100);
    const units = extractEvidenceFromPayload(
      'web_read',
      JSON.stringify({
        url: 'https://example.com/report',
        title: 'Report',
        content: body,
      }),
    );

    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      url: 'https://example.com/report',
      kind: 'body',
      strength: 'strong',
      tool: 'web_read',
    });
  });

  it('deduplicates repeated URL and evidence kind using the longest text', () => {
    const units = extractEvidenceFromPayload(
      'web_search',
      JSON.stringify({
        results: [
          { url: 'https://example.com/a', title: 'A', snippet: 'short' },
          { url: 'https://example.com/a', title: 'A', snippet: 'a much longer snippet' },
        ],
      }),
    );

    expect(units).toHaveLength(1);
    expect(units[0]?.text).toContain('a much longer snippet');
  });

  it('selects the strongest evidence attached to a URL', () => {
    const units = collectEvidenceUnits([
      {
        tool: 'web_search',
        sources: [{ url: 'https://example.com/a', title: 'Search result', snippet: 'blurb' }],
      },
      {
        evidence: extractEvidenceFromPayload(
          'web_read',
          JSON.stringify({
            url: 'https://example.com/a',
            content: 'Full body '.repeat(100),
          }),
        ),
      },
    ]);
    const index = buildEvidenceIndex(units, (url) => url);

    expect(strongestFor(index, 'https://example.com/a')?.strength).toBe('strong');
  });

  it('grades missing claims less severely for weak evidence than body text', () => {
    expect(gradeClaimGap({ missing: ['64,000'], strength: 'weak' })).toMatchObject({
      verdict: 'unverifiable',
      uiSeverity: 'warn',
    });
    expect(gradeClaimGap({ missing: ['64,000'], strength: 'strong' })).toMatchObject({
      verdict: 'unsupported',
      uiSeverity: 'error',
    });
  });
});
