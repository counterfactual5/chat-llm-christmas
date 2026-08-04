import { describe, expect, it } from 'vitest';
import {
  attachedFilesForUserBubbleDisplay,
  collapseAttachedFileBlocksForHistory,
  collapseAttachedFileBodiesInMessages,
  collectFileExtractsFromMessages,
  formatChatFileHistoryRefs,
  HISTORY_FILE_REF_MARKER,
  messagesHaveAttachedFiles,
  parseAttachedFileBlocks,
} from '@/lib/files/attached-file-blocks';
import {
  normalizeFileId as normalizeToolFileId,
  parseFileReadArgs as parseToolFileReadArgs,
} from '@/lib/tools/file-read/tool';

describe('attached-file-blocks', () => {
  it('parses name, optional fileId, and body', () => {
    const content = [
      '[Attached File: a.pdf] (stored fileId: file-abc)',
      'hello pdf',
      '',
      '---',
      '',
      'please summarize',
    ].join('\n');
    const blocks = parseAttachedFileBlocks(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      name: 'a.pdf',
      fileId: 'file-abc',
      body: 'hello pdf',
    });
  });

  it('collapses older bodies to describing + fileId', () => {
    const content = [
      '[Attached File: notes.txt] (stored fileId: file-1)',
      'alpha '.repeat(100),
      '',
      '---',
      '',
      'what does it say?',
    ].join('\n');
    const collapsed = collapseAttachedFileBlocksForHistory(content, {
      previewChars: 40,
    });
    expect(collapsed).toContain(HISTORY_FILE_REF_MARKER);
    expect(collapsed).toContain('fileId: file-1');
    expect(collapsed).toContain('file_read');
    expect(collapsed).toContain('what does it say?');
    expect(collapsed).not.toContain('alpha '.repeat(20));
  });

  it('formats assistant-delivered file refs for file_read', () => {
    const refs = formatChatFileHistoryRefs([
      { id: 'file-book', name: 'Guide.pdf', mimeType: 'application/pdf' },
      { id: 'file-book', name: 'dup.pdf' },
    ]);
    expect(refs).toContain(HISTORY_FILE_REF_MARKER);
    expect(refs).toContain('fileId: file-book');
    expect(refs).toContain('Guide.pdf');
    expect(refs).toContain('file_read');
    expect(refs.match(/file-book/g)?.length).toBe(1);
  });

  it('messagesHaveAttachedFiles sees assistant file refs', () => {
    expect(
      messagesHaveAttachedFiles([
        { role: 'user', content: 'download please' },
        {
          role: 'assistant',
          content: formatChatFileHistoryRefs([
            { id: 'file-1', name: 'a.pdf', mimeType: 'application/pdf' },
          ]),
        },
      ]),
    ).toBe(true);
    expect(
      messagesHaveAttachedFiles([
        {
          role: 'assistant',
          content: '',
          files: [{ id: 'file-2' }],
        },
      ]),
    ).toBe(true);
    expect(
      messagesHaveAttachedFiles([{ role: 'user', content: 'hello' }]),
    ).toBe(false);
  });

  it('onlyWithFileId keeps bodies without a stored id', () => {
    const content = [
      '[Attached File: local.txt]',
      'keep me whole',
      '',
      '---',
      '',
      'ask',
    ].join('\n');
    const collapsed = collapseAttachedFileBlocksForHistory(content, {
      onlyWithFileId: true,
    });
    expect(collapsed).toContain('[Attached File: local.txt]');
    expect(collapsed).toContain('keep me whole');
    expect(collapsed).not.toContain(HISTORY_FILE_REF_MARKER);
  });

  it('collapseAttachedFileBodiesInMessages keeps the latest user turn full', () => {
    const messages = [
      {
        role: 'user',
        content:
          '[Attached File: a.txt] (stored fileId: f1)\n' +
          'old body '.repeat(50) +
          '\n\n---\n\nold ask',
      },
      { role: 'assistant', content: 'ok' },
      {
        role: 'user',
        content:
          '[Attached File: b.txt] (stored fileId: f2)\n' +
          'new body full extract\n\n---\n\nnew ask',
      },
    ];
    const next = collapseAttachedFileBodiesInMessages(messages, {
      keepLastUserFull: true,
      onlyWithFileId: true,
    });
    expect(String(next[0].content)).toContain(HISTORY_FILE_REF_MARKER);
    expect(String(next[0].content)).not.toContain('old body '.repeat(45));
    expect(String(next[2].content)).toContain('new body full extract');
    expect(String(next[2].content)).toContain('[Attached File: b.txt]');
  });

  it('bubble display collapses full extracts', () => {
    const content =
      '[Attached File: a.pdf] (stored fileId: f)\n' +
      'x'.repeat(500) +
      '\n\n---\n\nsummarize';
    const shown = attachedFilesForUserBubbleDisplay(content);
    expect(shown).toContain(HISTORY_FILE_REF_MARKER);
    expect(shown).toContain('summarize');
    expect(shown).not.toContain('x'.repeat(450));
  });

  it('collects extracts keyed by fileId', () => {
    const extracts = collectFileExtractsFromMessages([
      {
        role: 'user',
        content:
          '[Attached File: a.txt] (stored fileId: fid/1)\nbody one\n\n---\n\nhi',
      },
      { role: 'assistant', content: 'ok' },
      {
        role: 'user',
        content:
          '[Attached File: a.txt] (stored fileId: fid/1)\nbody one longer extract\n\n---\n\nagain',
      },
    ]);
    expect(extracts['fid/1']?.text).toBe('body one longer extract');
    expect(extracts['fid/1']?.name).toBe('a.txt');
  });
});

describe('file_read arg parsing', () => {
  it('normalizes paths and marker scraps', () => {
    expect(normalizeToolFileId('/api/files/file%2F1')).toBe('file/1');
    expect(normalizeToolFileId('fileId: file-xyz)')).toBe('file-xyz');
    expect(parseToolFileReadArgs('{"file_id":"abc"}', '')).toEqual({
      fileId: 'abc',
      focus: '',
      startPage: 1,
      maxPages: 8,
      startPageExplicit: false,
    });
    expect(
      parseToolFileReadArgs(
        '{"file_id":"abc","start_page":12,"max_pages":4,"focus":"bitcoin"}',
        '',
      ),
    ).toEqual({
      fileId: 'abc',
      focus: 'bitcoin',
      startPage: 12,
      maxPages: 4,
      startPageExplicit: true,
    });
    // glm-style misuse: search-tool arg name `query` instead of `file_id`
    expect(
      parseToolFileReadArgs(
        '{"query":"file-9ca12cbaf7f93be7d9722cb38d24605f"}',
        '',
      ),
    ).toEqual({
      fileId: 'file-9ca12cbaf7f93be7d9722cb38d24605f',
      focus: '',
      startPage: 1,
      maxPages: 8,
      startPageExplicit: false,
    });
    expect(parseToolFileReadArgs('{"focus":"目录"}', '')).toEqual({
      fileId: '',
      focus: '',
      startPage: 1,
      maxPages: 8,
      startPageExplicit: false,
    });
  });
});
