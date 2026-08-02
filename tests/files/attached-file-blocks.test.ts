import { describe, expect, it } from 'vitest';
import {
  collapseAttachedFileBlocksForHistory,
  collectFileExtractsFromMessages,
  HISTORY_FILE_REF_MARKER,
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
    });
  });
});
