import { describe, expect, it } from 'vitest';
import { normalizeWikiQuery } from '@/lib/tools/search/wiki-query';

describe('normalizeWikiQuery', () => {
  it('splits bilingual titles for zh and en editions', () => {
    expect(normalizeWikiQuery('Bitcoin 比特币', { userAsk: '怎么没用维基百科' })).toEqual({
      query: '比特币',
      lang: 'zh',
    });
    expect(normalizeWikiQuery('Bitcoin 比特币', { lang: 'en' })).toEqual({
      query: 'Bitcoin',
      lang: 'en',
    });
  });

  it('keeps monolingual queries', () => {
    expect(normalizeWikiQuery('比特币', { userAsk: '介绍一下' })).toEqual({
      query: '比特币',
      lang: 'zh',
    });
    expect(normalizeWikiQuery('Bitcoin', { userAsk: 'What is it?' })).toEqual({
      query: 'Bitcoin',
      lang: 'en',
    });
  });
});
