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
    });
    expect(parseLiteratureCommand('/论文 大模型对齐')).toEqual({
      kind: 'papers',
      query: '大模型对齐',
      action: 'search',
    });
  });

  it('parses /books and download', () => {
    expect(parseLiteratureCommand('/books deep learning')).toEqual({
      kind: 'books',
      query: 'deep learning',
      action: 'search',
    });
    expect(parseLiteratureCommand('/books download some-book_id.2020')).toEqual({
      kind: 'books',
      action: 'download',
      identifier: 'some-book_id.2020',
    });
  });

  it('formats commands', () => {
    expect(formatLiteratureCommand('papers', 'RLHF')).toBe('/papers RLHF');
    expect(formatLiteratureCommand('books', 'Gödel Escher Bach')).toBe(
      '/books Gödel Escher Bach',
    );
    expect(formatBookDownloadCommand('foo')).toBe('/books download foo');
  });
});

describe('formatLiteratureMarkdown', () => {
  it('renders paper hits', () => {
    const md = formatLiteratureMarkdown('papers', 'attention', 'arxiv', [
      {
        title: 'Attention Is All You Need',
        url: 'https://arxiv.org/abs/1706.03762',
        authors: 'Vaswani et al.',
        year: '2017',
        sourceProvider: 'arxiv',
      },
    ]);
    expect(md).toContain('Attention Is All You Need');
    expect(md).toContain('arxiv.org');
  });

  it('mentions legal download command for books', () => {
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
  });
});
