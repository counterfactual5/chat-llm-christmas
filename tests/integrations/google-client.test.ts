import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  googleGetJson,
  googleSendJson,
} from '@/lib/integrations/google/client';

describe('Google API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends authenticated no-store GET requests and returns JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ emailAddress: 'person@example.com' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      googleGetJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', 'token-123'),
    ).resolves.toEqual({ emailAddress: 'person@example.com' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
          Accept: 'application/json',
        }),
      }),
    );
  });

  it('serializes mutation bodies and returns null for a 204 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      googleSendJson('https://www.googleapis.com/drive/v3/files/file-1', 'token-123', 'DELETE'),
    ).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files/file-1',
      expect.objectContaining({
        method: 'DELETE',
        cache: 'no-store',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      }),
    );
  });

  it('uses the Google API error message for failed responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Calendar API is disabled' } }), {
          status: 403,
          statusText: 'Forbidden',
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(
      googleGetJson('https://www.googleapis.com/calendar/v3/users/me/calendarList', 'token-123'),
    ).rejects.toThrow('Calendar API is disabled');
  });

  it('adds a JSON content type only when a mutation has a body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'created' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await googleSendJson('https://example.test/items', 'token-123', 'POST', { name: 'item' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/items',
      expect.objectContaining({
        body: JSON.stringify({ name: 'item' }),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    );
  });
});
