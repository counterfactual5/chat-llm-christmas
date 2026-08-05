import { describe, expect, it } from 'vitest';
import { auditCitations } from '@/lib/tools/review/checks/citation';
import { citationUrlKey, normalizeUrl } from '@/lib/tools/review/core/shared';
import type { ExecutionRecordEntry } from '@/lib/tools/review/core/types';

describe('citationUrlKey', () => {
  it('equates arXiv abs / pdf / html and strips version suffix', () => {
    const abs = citationUrlKey('https://arxiv.org/abs/2411.05951');
    const pdf = citationUrlKey('https://arxiv.org/pdf/2411.05951v1.pdf');
    const html = citationUrlKey('https://arxiv.org/html/2411.05951');
    expect(abs).toBe('arxiv.org/abs/2411.05951');
    expect(pdf).toBe(abs);
    expect(html).toBe(abs);
  });

  it('does not equate different arXiv papers', () => {
    expect(citationUrlKey('https://arxiv.org/abs/2411.05951')).not.toBe(
      citationUrlKey('https://arxiv.org/pdf/2506.11921v1.pdf'),
    );
  });

  it('leaves non-arXiv URLs as normalizeUrl (no extra looseness)', () => {
    const raw = 'https://www.example.com/paper?utm=1#frag';
    expect(citationUrlKey(raw)).toBe(normalizeUrl(raw));
  });
});

describe('auditCitations arXiv abs↔pdf', () => {
  const record: ExecutionRecordEntry[] = [
    {
      tool: 'paper_search',
      ok: true,
      sources: [
        {
          url: 'https://arxiv.org/abs/2411.05951',
          title: 'Example Paper',
          snippet: 'About consensus.',
        },
      ],
    },
  ];

  it('matches pdf cite against abs receipt', () => {
    const audit = auditCitations(
      'See [PDF](https://arxiv.org/pdf/2411.05951v1.pdf) for details.',
      record,
    );
    expect(audit).not.toBeNull();
    expect(audit!.matched).toBe(1);
    expect(audit!.unsupported).toEqual([]);
  });

  it('still flags an arXiv id that never appeared in receipts', () => {
    const audit = auditCitations(
      'Fake: [PDF](https://arxiv.org/pdf/9999.99999v1.pdf).',
      record,
    );
    expect(audit).not.toBeNull();
    expect(audit!.matched).toBe(0);
    expect(audit!.unsupported.some((u) => u.includes('9999.99999'))).toBe(true);
  });
});
