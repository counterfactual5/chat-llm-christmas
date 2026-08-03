import { describe, expect, it } from 'vitest';
import { extractUrls, normalizeUrl, trimUrlTail } from '@/lib/tools/review/core/shared';

describe('trimUrlTail', () => {
  it('strips markdown bold markers stuck to the URL', () => {
    expect(trimUrlTail('https://t.me/web3hiring**')).toBe('https://t.me/web3hiring');
    expect(trimUrlTail('https://t.me/DeJob_official**')).toBe('https://t.me/DeJob_official');
  });

  it('strips stacked closing punctuation', () => {
    expect(trimUrlTail('https://gitcoin.co/bounties)')).toBe('https://gitcoin.co/bounties');
    expect(trimUrlTail('https://example.com/path).')).toBe('https://example.com/path');
  });
});

describe('extractUrls', () => {
  it('does not keep ** glued from **https://…** prose', () => {
    const urls = extractUrls(
      '**https://t.me/DeJob_official**（搜索 DeJob） and https://t.me/web3hiring** (搜索)',
    );
    expect(urls).toEqual(['https://t.me/DeJob_official', 'https://t.me/web3hiring']);
  });

  it('normalizes polluted and clean forms to the same key', () => {
    expect(normalizeUrl('https://t.me/web3hiring**')).toBe(normalizeUrl('https://t.me/web3hiring'));
  });
});
