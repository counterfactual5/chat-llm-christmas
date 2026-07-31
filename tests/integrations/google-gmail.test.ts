import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  gmailBatchGetMessages,
  gmailGetAttachment,
  gmailSendMessage,
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
