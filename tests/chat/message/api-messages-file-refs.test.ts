import { describe, expect, it } from 'vitest';
import { toApiMessages } from '@/lib/chat/message/api-messages';
import type { Message } from '@/lib/chat/types';
import { HISTORY_FILE_REF_MARKER } from '@/lib/files/attached-file-blocks';

describe('toApiMessages assistant file refs', () => {
  it('injects 【历史文件引用】 for book_download file cards', () => {
    const messages: Message[] = [
      {
        id: 'u1',
        role: 'user',
        content: '/books download abc',
        timestamp: 1,
      },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        timestamp: 2,
        files: [
          {
            id: 'file-abc',
            name: 'Guide.pdf',
            mimeType: 'application/pdf',
            size: 100,
            url: '/api/files/file-abc',
            createdAt: 2,
          },
        ],
        toolRuns: [
          {
            id: 't1',
            name: 'book_download',
            status: 'done',
            query: 'abc',
            results: [
              {
                title: 'Guide',
                url: '/api/files/file-abc',
                snippet: 'Guide.pdf',
              },
            ],
          },
        ],
      },
    ];

    const api = toApiMessages(messages);
    const last = api[api.length - 1] as { role?: string; content?: string };
    expect(last.role).toBe('assistant');
    expect(String(last.content || '')).toContain(HISTORY_FILE_REF_MARKER);
    expect(String(last.content || '')).toContain('fileId: file-abc');
    expect(String(last.content || '')).toContain('Guide.pdf');
    expect(String(last.content || '')).toContain('file_read');
  });
});
