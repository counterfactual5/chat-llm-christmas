import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  gmailApplyLabelByQuery,
  gmailBatchGetMessages,
  gmailBatchModifyByQuery,
  gmailBatchTrashByQuery,
  gmailGetAttachment,
  gmailSearchMessages,
  gmailSendMessage,
  gmailThreadMarkRead,
} from '@/lib/integrations/google/gmail';

function base64Url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

describe('Gmail helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deduplicates and caps batch message reads at 20 ids', async () => {
    const ids = [
      ...Array.from({ length: 25 }, (_, index) => `message-${index}`),
      'message-0',
      '  message-1  ',
    ];
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const id = new URL(url).pathname.split('/').at(-1)?.replace('messages', '');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id,
            payload: { headers: [] },
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(gmailBatchGetMessages('token-123', ids)).resolves.toMatchObject({ count: 20 });
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  it('gmail_search returns full ids[] even when metadata enrichment is capped', async () => {
    const listIds = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}` }));
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('messages?')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ messages: listIds, resultSizeEstimate: 20 }),
            { status: 200 },
          ),
        );
      }
      const id = new URL(url).pathname.split('/').at(-1) || '';
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id,
            threadId: `t-${id}`,
            snippet: 'hi',
            payload: {
              headers: [
                { name: 'Subject', value: `Subj ${id}` },
                { name: 'From', value: 'a@b.com' },
              ],
            },
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await gmailSearchMessages('token-123', { query: 'is:unread', maxResults: 50 });
    expect(out.ids).toHaveLength(20);
    expect(out.messages.length).toBeLessThanOrEqual(15);
    expect(out.messages[0]?.id).toBe('m0');
  });

  it('batch modifies by query across list pages', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (String(init?.method || 'GET').toUpperCase() === 'POST' && url.includes('batchModify')) {
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      if (url.includes('pageToken=page2')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ messages: [{ id: 'c' }, { id: 'd' }] }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            messages: [{ id: 'a' }, { id: 'b' }],
            nextPageToken: 'page2',
            resultSizeEstimate: 4,
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await gmailBatchModifyByQuery('token-123', {
      query: 'is:unread',
      removeLabelIds: ['UNREAD'],
      maxTotal: 10,
    });
    expect(out).toMatchObject({
      ok: true,
      query: 'is:unread',
      modified: 4,
      truncated: false,
    });
    expect(out.sampleIds).toEqual(['a', 'b', 'c', 'd']);
  });

  it('applies a label by display name via query', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/labels') && !url.includes('messages')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              labels: [
                { id: 'Label_9', name: 'Receipts' },
                { id: 'INBOX', name: 'INBOX' },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      if (String(init?.method || 'GET').toUpperCase() === 'POST' && url.includes('batchModify')) {
        const body = JSON.parse(String(init?.body || '{}')) as {
          addLabelIds?: string[];
          ids?: string[];
        };
        expect(body.addLabelIds).toEqual(['Label_9']);
        expect(body.ids).toEqual(['m1']);
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      if (url.includes('messages?')) {
        return Promise.resolve(
          new Response(JSON.stringify({ messages: [{ id: 'm1' }] }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await gmailApplyLabelByQuery('token-123', {
      query: 'from:store@example.com',
      label: 'receipts',
      action: 'add',
    });
    expect(out).toMatchObject({
      ok: true,
      modified: 1,
      action: 'add',
      label: { id: 'Label_9', name: 'Receipts' },
    });
  });

  it('batch trash adds TRASH and removes INBOX', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (String(init?.method || 'GET').toUpperCase() === 'POST' && url.includes('batchModify')) {
        const body = JSON.parse(String(init?.body || '{}')) as {
          addLabelIds?: string[];
          removeLabelIds?: string[];
        };
        expect(body.addLabelIds).toEqual(['TRASH']);
        expect(body.removeLabelIds).toEqual(['INBOX']);
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ messages: [{ id: 'x' }] }), { status: 200 }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      gmailBatchTrashByQuery('token-123', { query: 'category:promotions older_than:1y' }),
    ).resolves.toMatchObject({ ok: true, modified: 1 });
  });

  it('marks a whole thread read via threads.modify', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      expect(url).toContain('/threads/thread-42/modify');
      expect(String(init?.method)).toBe('POST');
      const body = JSON.parse(String(init?.body || '{}')) as { removeLabelIds?: string[] };
      expect(body.removeLabelIds).toEqual(['UNREAD']);
      return Promise.resolve(new Response(JSON.stringify({ id: 'thread-42' }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(gmailThreadMarkRead('token-123', 'thread-42')).resolves.toMatchObject({
      ok: true,
      threadId: 'thread-42',
    });
  });

  it('builds a URL-safe MIME payload and keeps the requested thread id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'sent-1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await gmailSendMessage('token-123', {
      to: 'to@example.com',
      cc: 'cc@example.com',
      subject: 'Hello',
      body: 'Message body',
      threadId: 'thread-1',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(String(init.body)) as { raw: string; threadId: string };
    expect(requestBody.threadId).toBe('thread-1');
    expect(requestBody.raw).not.toMatch(/[+/=]/);
    expect(atob(requestBody.raw.replace(/-/g, '+').replace(/_/g, '/'))).toContain(
      'To: to@example.com',
    );
  });

  it('returns a base64 preview for binary-looking attachments', async () => {
    const binaryPayload = base64Url('\u0000\u0001\u0002binary');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: binaryPayload, size: 9 }), { status: 200 }),
      ),
    );

    await expect(
      gmailGetAttachment('token-123', { messageId: 'message/1', attachmentId: 'attachment 1' }),
    ).resolves.toMatchObject({
      encoding: 'base64url',
      dataPreview: binaryPayload,
      note: 'Binary attachment; dataPreview is truncated base64url.',
    });
  });
});
