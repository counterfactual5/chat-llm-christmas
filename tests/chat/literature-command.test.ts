import { describe, expect, it } from 'vitest';
import {
  formatBookDownloadCommand,
  formatLiteratureCommand,
  parseLiteratureCommand,
} from '@/lib/chat/turn/literature-command';
import { formatLiteratureMarkdown } from '@/lib/chat/turn/literature-search';

describe('parseLiteratureCommand', () => {
  it('parses /papers and aliases', () => {
    expect(parseLiteratureCommand('/papers transformer attention')).toEqual({
      kind: 'papers',
      query: 'transformer attention',
      action: 'search',
      source: 'auto',
    });
    expect(parseLiteratureCommand('/论文 大模型对齐')).toEqual({
      kind: 'papers',
      query: '大模型对齐',
      action: 'search',
      source: 'auto',
    });
  });

  it('parses paper sources and graph actions', () => {
    expect(parseLiteratureCommand('/papers arxiv LLM agent')).toEqual({
      kind: 'papers',
      action: 'search',
      query: 'LLM agent',
      source: 'arxiv',
    });
    expect(parseLiteratureCommand('/papers semantic yield curve')).toEqual({
      kind: 'papers',
      action: 'search',
      query: 'yield curve',
      source: 'semantic',
    });
    expect(parseLiteratureCommand('/papers details ARXIV:1706.03762')).toEqual({
      kind: 'papers',
      action: 'details',
      query: 'ARXIV:1706.03762',
      paperId: 'ARXIV:1706.03762',
    });
    expect(parseLiteratureCommand('/papers citations DOI:10.1038/s41586-023-06592-0')).toEqual({
      kind: 'papers',
      action: 'citations',
      query: 'DOI:10.1038/s41586-023-06592-0',
      paperId: 'DOI:10.1038/s41586-023-06592-0',
    });
    expect(parseLiteratureCommand('/papers author Yann LeCun')).toEqual({
      kind: 'papers',
      action: 'author',
      query: 'Yann LeCun',
    });
  });

  it('strips conversational wrappers for book queries', () => {
    expect(parseLiteratureCommand('/books 给我找找毛选')).toEqual({
      kind: 'books',
      action: 'search',
      query: '毛泽东选集',
      source: 'auto',
    });
    expect(parseLiteratureCommand('/books 帮我找 Deep Learning')).toEqual({
      kind: 'books',
      action: 'search',
      query: 'Deep Learning',
      source: 'auto',
    });
  });

  it('accepts fullwidth slash prefixes (common after edit/paste)', () => {
    expect(parseLiteratureCommand('／books 毛泽东选集')).toEqual({
      kind: 'books',
      action: 'search',
      query: '毛泽东选集',
      source: 'auto',
    });
  });

  it('parses /books sources and download', () => {
    expect(parseLiteratureCommand('/books deep learning')).toEqual({
      kind: 'books',
      query: 'deep learning',
      action: 'search',
      source: 'auto',
    });
    expect(parseLiteratureCommand('/books aibooks Deep Learning')).toEqual({
      kind: 'books',
      action: 'search',
      query: 'Deep Learning',
      source: 'aibooks',
    });
    expect(parseLiteratureCommand('/books trading HFT')).toEqual({
      kind: 'books',
      action: 'search',
      query: 'HFT',
      source: 'trading',
    });
    expect(parseLiteratureCommand('/books libgen Deep Learning')).toEqual({
      kind: 'books',
      action: 'search',
      query: 'Deep Learning',
      source: 'libgen',
    });
    expect(parseLiteratureCommand('/books download some-book_id.2020')).toEqual({
      kind: 'books',
      action: 'download',
      identifier: 'some-book_id.2020',
    });
    expect(
      parseLiteratureCommand(
        '/books download libgen:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ).toEqual({
      kind: 'books',
      action: 'download',
      identifier: 'libgen:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
  });

  it('formats commands', () => {
    expect(formatLiteratureCommand('papers', 'RLHF')).toBe('/papers RLHF');
    expect(formatLiteratureCommand('papers', 'RLHF', { source: 'arxiv' })).toBe(
      '/papers arxiv RLHF',
    );
    expect(formatLiteratureCommand('papers', 'ARXIV:1', { action: 'details' })).toBe(
      '/papers details ARXIV:1',
    );
    expect(formatLiteratureCommand('books', 'Gödel Escher Bach')).toBe(
      '/books Gödel Escher Bach',
    );
    expect(formatLiteratureCommand('books', 'python', { source: 'fpb' })).toBe(
      '/books fpb python',
    );
    expect(formatBookDownloadCommand('foo')).toBe('/books download foo');
  });
});

describe('formatLiteratureMarkdown', () => {
  it('renders paper hits with TLDR and citations', () => {
    const md = formatLiteratureMarkdown('papers', 'attention', 'arxiv', [
      {
        title: 'Attention Is All You Need',
        url: 'https://arxiv.org/abs/1706.03762',
        authors: 'Vaswani et al.',
        year: '2017',
        sourceProvider: 'arxiv',
        paperId: 'ARXIV:1706.03762',
        citationCount: 100000,
        tldr: 'Transformers use attention only.',
      },
    ]);
    expect(md).toContain('Attention Is All You Need');
    expect(md).toContain('arxiv.org');
    expect(md).toContain('TLDR');
    expect(md).toContain('ARXIV:1706.03762');
  });

  it('renders author hits', () => {
    const md = formatLiteratureMarkdown('papers', 'LeCun', 'semantic-scholar', [], {
      action: 'author',
      authors: [
        {
          name: 'Yann LeCun',
          paperCount: 100,
          citationCount: 200000,
          hIndex: 150,
          authorId: '123',
          url: 'https://www.semanticscholar.org/author/123',
        },
      ],
    });
    expect(md).toContain('Yann LeCun');
    expect(md).toContain('h-index 150');
  });

  it('mentions download command for books including libgen', () => {
    const md = formatLiteratureMarkdown('books', 'calculus', 'internet-archive', [
      {
        title: 'Calculus',
        url: 'https://archive.org/details/calculus',
        archiveId: 'calculus',
        downloadable: true,
        sourceProvider: 'internet-archive',
      },
    ]);
    expect(md).toContain('/books download calculus');

    const lg = formatLiteratureMarkdown('books', 'deep learning', 'libgen', [
      {
        title: 'Deep Learning',
        url: 'https://libgen.li/ads.php?md5=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        archiveId: 'libgen:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        md5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        downloadable: true,
        sourceProvider: 'libgen',
        size: '12.3 MB',
      },
    ]);
    expect(lg).toContain('/books download libgen:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(lg).toContain('12.3 MB');
  });
});
