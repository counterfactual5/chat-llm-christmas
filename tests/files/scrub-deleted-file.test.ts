import { describe, expect, it } from 'vitest';
import {
  scrubFileIdFromContent,
  scrubFileIdFromMessage,
  scrubFileIdFromSessions,
  scrubMissingAccountFiles,
} from '@/lib/files/scrub-deleted-file';
import type { ChatSession, Message } from '@/lib/chat/types';

const FILE_ID = 'file-9ca12cbaf7f93be7d9722cb38d24605f';

describe('scrub-deleted-file', () => {
  it('removes attached-file bodies and history ref lines for the id', () => {
    const content = [
      `[Attached File: book.pdf] (stored fileId: ${FILE_ID})`,
      'full extract text here',
      '',
      '---',
      '',
      '试试这个',
      '',
      '【历史文件引用】',
      `- book.pdf (fileId: ${FILE_ID}): preview…`,
      '- keep.pdf (fileId: file-keep1234567890): other',
      '如需全文请调用 file_read（传入 file_id）。',
    ].join('\n');

    const next = scrubFileIdFromContent(content, FILE_ID);
    expect(next).not.toContain(FILE_ID);
    expect(next).toContain('试试这个');
    expect(next).toContain('file-keep1234567890');
    expect(next).toContain('【历史文件引用】');
  });

  it('drops empty history marker blocks entirely', () => {
    const content = [
      '【历史文件引用】',
      `- only.pdf (fileId: ${FILE_ID})`,
      '如需全文请调用 file_read（传入 file_id）。这些文件已保存在本对话 / Files，无需用户重新上传。',
      '',
      'user ask remains',
    ].join('\n');
    const next = scrubFileIdFromContent(content, FILE_ID);
    expect(next).not.toContain('【历史文件引用】');
    expect(next).toContain('user ask remains');
  });

  it('removes image archive lines for the id', () => {
    const content = [
      'desc',
      '【原图存档】',
      `- /api/files/${FILE_ID}`,
      '- /api/files/file-otherimage0001',
    ].join('\n');
    const next = scrubFileIdFromContent(content, FILE_ID);
    expect(next).not.toContain(FILE_ID);
    expect(next).toContain('file-otherimage0001');
  });

  it('scrubs structured message fields and session webSources', () => {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: `see 【历史文件引用】\n- x (fileId: ${FILE_ID})`,
      timestamp: 1,
      files: [
        {
          id: FILE_ID,
          name: 'x.pdf',
          mimeType: 'application/pdf',
          size: 1,
          url: `/api/files/${FILE_ID}`,
          createdAt: 1,
        },
      ],
      activity: [{ id: 'a1', kind: 'file', fileId: FILE_ID }],
    };
    const scrubbed = scrubFileIdFromMessage(msg, FILE_ID);
    expect(scrubbed.files).toBeUndefined();
    expect(scrubbed.activity).toBeUndefined();
    expect(scrubbed.content).not.toContain(FILE_ID);

    const session: ChatSession = {
      id: 's1',
      title: 't',
      messages: [msg],
      updatedAt: 1,
      webSources: [
        {
          title: 'x.pdf',
          url: `/api/files/${FILE_ID}`,
          snippet: '',
        },
        {
          title: 'keep',
          url: 'https://example.com',
          snippet: '',
        },
      ],
    };
    const sessions = scrubFileIdFromSessions([session], FILE_ID);
    expect(sessions[0]?.messages[0]?.files).toBeUndefined();
    expect(sessions[0]?.webSources?.some((s) => s.url.includes(FILE_ID))).toBe(
      false,
    );
    expect(sessions[0]?.webSources?.some((s) => s.url === 'https://example.com')).toBe(
      true,
    );
  });

  it('reconciles already-deleted ids when account listing is complete', () => {
    const session: ChatSession = {
      id: 's1',
      title: 't',
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: `【历史文件引用】\n- gone.pdf (fileId: ${FILE_ID})\n- keep.pdf (fileId: file-keep1234567890)`,
          timestamp: 1,
        },
      ],
      updatedAt: 1,
    };
    const untouched = scrubMissingAccountFiles([session], [FILE_ID, 'file-keep1234567890']);
    expect(untouched).toBe(untouched);
    // early-return keeps the same sessions array reference
    const input = [session];
    expect(scrubMissingAccountFiles(input, [FILE_ID, 'file-keep1234567890'])).toBe(input);
    expect(input[0]?.messages[0]?.content).toContain(FILE_ID);

    const cleaned = scrubMissingAccountFiles([session], ['file-keep1234567890']);
    expect(cleaned[0]?.messages[0]?.content).not.toContain(FILE_ID);
    expect(cleaned[0]?.messages[0]?.content).toContain('file-keep1234567890');
  });
});
