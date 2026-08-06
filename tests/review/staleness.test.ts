import { describe, expect, it } from 'vitest';
import { buildStalenessCheck } from '@/lib/tools/review/checks/staleness';
import type { ExecutionRecordEntry } from '@/lib/tools/review/core/types';

const NOW = new Date('2026-08-06T12:00:00+08:00');

function webRecord(
  sources: Array<{ url: string; title?: string; snippet?: string }>,
): ExecutionRecordEntry[] {
  return [
    {
      tool: 'web_search',
      ok: true,
      sources,
    },
  ];
}

describe('buildStalenessCheck', () => {
  it('flags prior-year sources for present-tense claims (same calendar year required)', () => {
    const check = buildStalenessCheck(
      '目前联通已获批 iPhone Air eSIM 试点，是最新进展。',
      webRecord([
        {
          url: 'https://www.stdaily.com/web/gdxw/2025-10/14/content_414796.html',
          title: '支持',
          snippet: '科技日报报道',
        },
      ]),
      NOW,
    );
    expect(check).not.toBeNull();
    expect(check!.clean).toBe(false);
    expect(check!.items.some((i) => i.ruleId === 'staleness:newest_source')).toBe(true);
    expect(check!.summary).toMatch(/freshness risk/);
  });

  it('stays clean when newest dated source is the current year', () => {
    const check = buildStalenessCheck(
      '目前联通已获批 iPhone Air eSIM 试点，是最新进展。',
      webRecord([
        {
          url: 'https://news.example.com/2026-07/01/esim.html',
          title: '联通获批 eSIM',
          snippet: '2026年7月消息',
        },
      ]),
      NOW,
    );
    expect(check).not.toBeNull();
    expect(check!.clean).toBe(true);
    expect(check!.summary).toContain('backed by retrieval');
  });

  it('does not run without web search/read receipts', () => {
    expect(
      buildStalenessCheck('目前这是最新进展。', [{ tool: 'image_understand', ok: true }], NOW),
    ).toBeNull();
  });
});
