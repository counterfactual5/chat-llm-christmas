import { describe, expect, it } from 'vitest';
import { isClickableSlashCommand } from '@/components/chat/message/AnswerMarkdown';
import {
  formatBookDownloadCommand,
  formatLiteratureCommand,
  formatPaperDownloadCommand,
  inferBookDownloadProvider,
  inferPaperDownloadProvider,
  isValidBookDownloadIdentifier,
  isValidPaperDownloadIdentifier,
  markdownLinkLabel,
  parseLiteratureCommand,
  resolveBookDownloadIdentifier,
  resolvePaperDownloadIdentifier,
} from '@/lib/chat/turn/literature-command';
import {
  buildLiteratureSearchThread,
  formatLiteratureMarkdown,
} from '@/lib/chat/turn/literature-search';
import { buildBookDownloadThread } from '@/lib/chat/turn/book-download-turn';
import { buildPaperDownloadThread } from '@/lib/chat/turn/paper-download-turn';
import { formatHitsForModel } from '@/lib/tools/literature/tool';

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
      query: '毛选',
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

  it('rejects placeholder /books download ids instead of searching', () => {
    expect(parseLiteratureCommand('/books download')).toEqual({
      kind: 'books',
      action: 'download',
      identifier: '',
      error: 'missing_identifier',
    });
    expect(parseLiteratureCommand('/books download libgen:<md5>')).toEqual({
      kind: 'books',
      action: 'download',
      identifier: 'libgen:<md5>',
      error: 'invalid_identifier',
    });
    expect(parseLiteratureCommand('/books download <md5>')).toEqual({
      kind: 'books',
      action: 'download',
      identifier: '<md5>',
      error: 'invalid_identifier',
    });
    expect(parseLiteratureCommand('/books download libgen:not-an-md5')).toEqual({
      kind: 'books',
      action: 'download',
      identifier: 'libgen:not-an-md5',
      error: 'invalid_identifier',
    });
  });

  it('parses /papers download and rejects placeholders', () => {
    expect(parseLiteratureCommand('/papers download ARXIV:1706.03762')).toEqual({
      kind: 'papers',
      action: 'download',
      identifier: 'ARXIV:1706.03762',
    });
    expect(parseLiteratureCommand('/papers download DOI:10.1038/s41586-023-06592-0')).toEqual({
      kind: 'papers',
      action: 'download',
      identifier: 'DOI:10.1038/s41586-023-06592-0',
    });
    expect(parseLiteratureCommand('/papers download 1706.03762')).toEqual({
      kind: 'papers',
      action: 'download',
      identifier: '1706.03762',
    });
    expect(
      parseLiteratureCommand(
        '/papers download https://arxiv.org/pdf/1706.03762.pdf',
      ),
    ).toEqual({
      kind: 'papers',
      action: 'download',
      identifier: 'https://arxiv.org/pdf/1706.03762.pdf',
    });
    expect(
      parseLiteratureCommand('/papers download abcdefghijklmnop'),
    ).toEqual({
      kind: 'papers',
      action: 'download',
      identifier: 'abcdefghijklmnop',
    });
    expect(parseLiteratureCommand('/papers download')).toEqual({
      kind: 'papers',
      action: 'download',
      identifier: '',
      error: 'missing_identifier',
    });
    expect(parseLiteratureCommand('/papers download <id>')).toEqual({
      kind: 'papers',
      action: 'download',
      identifier: '<id>',
      error: 'invalid_identifier',
    });
    expect(parseLiteratureCommand('/papers download ARXIV:<id>')).toEqual({
      kind: 'papers',
      action: 'download',
      identifier: 'ARXIV:<id>',
      error: 'invalid_identifier',
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
    expect(formatPaperDownloadCommand('ARXIV:1706.03762')).toBe(
      '/papers download ARXIV:1706.03762',
    );
  });
});

describe('formatLiteratureMarkdown', () => {
  it('renders paper hits with TLDR, clickable actions, and PDF link', () => {
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
        pdfUrl: 'https://arxiv.org/pdf/1706.03762.pdf',
      },
    ]);
    expect(md).toContain('Attention Is All You Need');
    expect(md).toContain('arxiv.org');
    expect(md).toContain('TLDR');
    expect(md).toContain('ARXIV:1706.03762');
    expect(md).toContain('/papers details ARXIV:1706.03762');
    expect(md).toContain('/papers citations ARXIV:1706.03762');
    expect(md).toContain('/papers references ARXIV:1706.03762');
    expect(md).toContain('/papers download ARXIV:1706.03762');
    expect(md).toMatch(
      /Actions: `\/papers details ARXIV:1706\.03762` · `\/papers citations ARXIV:1706\.03762` · `\/papers references ARXIV:1706\.03762`/,
    );
    expect(md).toContain('[Open PDF](https://arxiv.org/pdf/1706.03762.pdf)');
    expect(md.split('\n').filter((l) => l.includes('/papers details')).length).toBe(1);
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

  it('shows alternate downloads kept after title+author dedupe', () => {
    const md = formatLiteratureMarkdown('books', '区块链', 'libgen', [
      {
        title: '区块链',
        url: 'https://libgen.li/ads.php?md5=70a383c096ff335b1ec51de27571d04c',
        md5: '70a383c096ff335b1ec51de27571d04c',
        downloadable: true,
        format: 'epub',
        size: '6 MB',
        sourceProvider: 'libgen',
        alternates: [
          {
            format: 'mobi',
            size: '7 MB',
            md5: '313848e5d3427b4983b8f90162f59cea',
          },
        ],
      },
    ]);
    expect(md).toContain('/books download libgen:70a383c096ff335b1ec51de27571d04c');
    expect(md).toContain('Size: 6 MB');
    expect(md).toContain('Alt download (mobi · 7 MB)');
    expect(md).toContain('/books download libgen:313848e5d3427b4983b8f90162f59cea');
  });

  it('uses gutenberg: id and Manual download when not API-downloadable', () => {
    const gut = formatLiteratureMarkdown('books', 'pride', 'gutenberg', [
      {
        title: 'Pride and Prejudice',
        url: 'https://www.gutenberg.org/ebooks/1342',
        archiveId: 'gutenberg:1342',
        downloadUrl: 'https://www.gutenberg.org/ebooks/1342.epub.images',
        downloadable: true,
        sourceProvider: 'gutenberg',
      },
    ]);
    expect(gut).toContain('/books download gutenberg:1342');
    expect(gut).not.toContain('1342.epub.images');

    const ol = formatLiteratureMarkdown('books', 'mao', 'open-library', [
      {
        title: '毛泽东选集',
        url: 'https://openlibrary.org/works/OL123W',
        downloadable: false,
        sourceProvider: 'open-library',
      },
    ]);
    expect(ol).toContain(
      'Manual download: [毛泽东选集](https://openlibrary.org/works/OL123W)',
    );
    expect(ol).not.toContain('/books download');

    const bracketTitle = formatLiteratureMarkdown('books', 'x', 'open-library', [
      {
        title: 'Foo [bar] Baz',
        url: 'https://openlibrary.org/works/OL9W',
        downloadable: false,
        sourceProvider: 'open-library',
      },
    ]);
    expect(bracketTitle).toContain(
      'Manual download: [Foo bar Baz](https://openlibrary.org/works/OL9W)',
    );
  });
});

describe('inferBookDownloadProvider / markdownLinkLabel', () => {
  it('labels providers from identifiers', () => {
    expect(inferBookDownloadProvider('libgen:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(
      'libgen',
    );
    expect(inferBookDownloadProvider('gutenberg:1342')).toBe('gutenberg');
    expect(inferBookDownloadProvider('https://example.com/a.epub')).toBe('direct');
    expect(inferBookDownloadProvider('calculus')).toBe('internet-archive');
    expect(markdownLinkLabel('A [B] C')).toBe('A B C');
    expect(markdownLinkLabel('')).toBe('Page');
  });
});

describe('inferPaperDownloadProvider / resolvePaperDownloadIdentifier', () => {
  it('labels providers and resolves download targets', () => {
    expect(inferPaperDownloadProvider('ARXIV:1706.03762')).toBe('arxiv');
    expect(inferPaperDownloadProvider('1706.03762')).toBe('arxiv');
    expect(inferPaperDownloadProvider('DOI:10.1/x')).toBe('doi');
    expect(inferPaperDownloadProvider('https://example.com/a.pdf')).toBe('direct');
    expect(inferPaperDownloadProvider('abcdefghijklmnop')).toBe('semantic-scholar');

    expect(
      resolvePaperDownloadIdentifier({
        paperId: 'ARXIV:1706.03762',
        pdfUrl: 'https://arxiv.org/pdf/1706.03762.pdf',
      }),
    ).toBe('ARXIV:1706.03762');
    expect(
      resolvePaperDownloadIdentifier({
        paperId: 'abcdefghijklmnop',
        pdfUrl: 'https://example.com/a.pdf',
      }),
    ).toBe('abcdefghijklmnop');
    expect(
      resolvePaperDownloadIdentifier({
        pdfUrl: 'https://arxiv.org/pdf/1706.03762.pdf',
      }),
    ).toBe('https://arxiv.org/pdf/1706.03762.pdf');
    expect(
      resolvePaperDownloadIdentifier({
        url: 'https://arxiv.org/abs/1706.03762',
      }),
    ).toBe('ARXIV:1706.03762');
    expect(
      resolvePaperDownloadIdentifier({
        doi: '10.1038/s41586-023-06592-0',
      }),
    ).toBe('DOI:10.1038/s41586-023-06592-0');
    expect(isValidPaperDownloadIdentifier('ARXIV:1706.03762')).toBe(true);
    expect(isValidPaperDownloadIdentifier('1706.03762v2')).toBe(true);
    expect(isValidPaperDownloadIdentifier('short')).toBe(false);
    expect(isValidPaperDownloadIdentifier('<id>')).toBe(false);
  });
});

describe('resolveBookDownloadIdentifier', () => {
  it('prefers md5, then archive id, then downloadUrl, then archive.org URL', () => {
    expect(
      resolveBookDownloadIdentifier({
        md5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        archiveId: 'other',
      }),
    ).toBe('libgen:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(resolveBookDownloadIdentifier({ archiveId: 'calculus' })).toBe('calculus');
    expect(
      resolveBookDownloadIdentifier({
        archiveId: 'gutenberg:1342',
        downloadUrl: 'https://example.com/book.epub',
      }),
    ).toBe('gutenberg:1342');
    expect(
      resolveBookDownloadIdentifier({
        url: 'https://archive.org/details/fanqienovel-123',
      }),
    ).toBe('fanqienovel-123');
    expect(
      resolveBookDownloadIdentifier({
        url: 'https://libgen.li/ads.php?md5=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    ).toBe('libgen:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(isValidBookDownloadIdentifier('gutenberg:1342')).toBe(true);
    expect(isValidBookDownloadIdentifier('gutenberg:abc')).toBe(false);
  });
});

describe('isClickableSlashCommand', () => {
  it('accepts book download and paper action commands', () => {
    expect(isClickableSlashCommand('/books download calculus')).toBe(true);
    expect(isClickableSlashCommand('/papers download ARXIV:1706.03762')).toBe(true);
    expect(isClickableSlashCommand('/papers details ARXIV:1')).toBe(true);
    expect(isClickableSlashCommand('/papers citations DOI:10.1/x')).toBe(true);
    expect(isClickableSlashCommand('/papers references ARXIV:1')).toBe(true);
    expect(isClickableSlashCommand('/papers attention')).toBe(false);
    expect(isClickableSlashCommand('/books calculus')).toBe(false);
  });
});

describe('formatHitsForModel', () => {
  it('includes downloadCommand for books and paper action commands', () => {
    const books = JSON.parse(
      formatHitsForModel('books', 'calculus', 'merged', [
        {
          title: 'Calculus',
          url: 'https://archive.org/details/calculus',
          archiveId: 'calculus',
          downloadable: true,
          sourceProvider: 'internet-archive',
        },
        {
          title: 'OL only',
          url: 'https://openlibrary.org/works/OL1W',
          downloadable: false,
          sourceProvider: 'open-library',
        },
      ]),
    );
    expect(books.results[0].downloadCommand).toBe('/books download calculus');
    expect(books.results[1].downloadCommand).toBeUndefined();
    expect(books.results[1].url).toContain('openlibrary.org');

    const withAlt = JSON.parse(
      formatHitsForModel('books', '区块链', 'libgen', [
        {
          title: '区块链',
          url: 'https://libgen.li/ads.php?md5=70a383c096ff335b1ec51de27571d04c',
          md5: '70a383c096ff335b1ec51de27571d04c',
          downloadable: true,
          format: 'epub',
          size: '6 MB',
          alternates: [
            {
              format: 'mobi',
              size: '7 MB',
              md5: '313848e5d3427b4983b8f90162f59cea',
            },
          ],
        },
      ]),
    );
    expect(withAlt.results[0].downloadCommand).toContain('70a383c096ff335b1ec51de27571d04c');
    expect(withAlt.results[0].alternateDownloads).toEqual([
      {
        format: 'mobi',
        size: '7 MB',
        downloadCommand: '/books download libgen:313848e5d3427b4983b8f90162f59cea',
      },
    ]);

    const papers = JSON.parse(
      formatHitsForModel('papers', 'attention', 'arxiv', [
        {
          title: 'Attention',
          url: 'https://arxiv.org/abs/1706.03762',
          paperId: 'ARXIV:1706.03762',
          pdfUrl: 'https://arxiv.org/pdf/1706.03762.pdf',
        },
      ]),
    );
    expect(papers.results[0].detailsCommand).toBe('/papers details ARXIV:1706.03762');
    expect(papers.results[0].citationsCommand).toBe('/papers citations ARXIV:1706.03762');
    expect(papers.results[0].referencesCommand).toBe(
      '/papers references ARXIV:1706.03762',
    );
    expect(papers.results[0].downloadCommand).toBe(
      '/papers download ARXIV:1706.03762',
    );
  });
});

describe('literature/book Process toolRuns', () => {
  const genId = (() => {
    let n = 0;
    return () => `id-${++n}`;
  })();

  it('seeds paper_search under Process (empty body + activity tool step)', () => {
    const result = buildLiteratureSearchThread({
      kind: 'papers',
      query: 'attention',
      cleanedBase: [],
      now: () => 1,
      genId,
    });
    const assistant = result.thread[result.thread.length - 1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toBe('');
    expect(assistant.toolRuns?.[0]).toMatchObject({
      id: result.toolRunId,
      name: 'paper_search',
      status: 'start',
      query: 'attention',
    });
    expect(assistant.activity?.[0]).toMatchObject({
      kind: 'tool',
      toolRunId: result.toolRunId,
    });
  });

  it('seeds book_search and book_download the same way', () => {
    const search = buildLiteratureSearchThread({
      kind: 'books',
      query: 'calculus',
      cleanedBase: [],
      now: () => 1,
      genId,
    });
    expect(search.thread.at(-1)?.toolRuns?.[0]?.name).toBe('book_search');

    const dl = buildBookDownloadThread({
      identifier: 'calculus',
      cleanedBase: [],
      now: () => 1,
      genId,
    });
    expect(dl.thread.at(-1)?.toolRuns?.[0]).toMatchObject({
      name: 'book_download',
      status: 'start',
      query: 'calculus',
    });
    expect(dl.thread.at(-1)?.activity?.[0]?.kind).toBe('tool');
  });

  it('seeds paper_download the same way', () => {
    const dl = buildPaperDownloadThread({
      identifier: 'ARXIV:1706.03762',
      cleanedBase: [],
      now: () => 1,
      genId,
    });
    expect(dl.thread.at(-1)?.toolRuns?.[0]).toMatchObject({
      name: 'paper_download',
      status: 'start',
      query: 'ARXIV:1706.03762',
    });
    expect(dl.thread.at(-1)?.activity?.[0]?.kind).toBe('tool');
  });
});
