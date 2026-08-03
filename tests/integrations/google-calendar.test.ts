import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calendarCreateEvent,
  calendarDeleteByQuery,
  calendarDeleteEvent,
  calendarFindFreeSlots,
  calendarListEvents,
  calendarQuickAdd,
  calendarRsvp,
} from '@/lib/integrations/google/calendar';

describe('Google Calendar helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists upcoming events with Calendar defaults and ids[]', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ items: [{ id: 'e1', summary: 'A' }], nextPageToken: 'p2' }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await calendarListEvents('token-123', {
      calendarId: 'team calendar',
      maxResults: 100,
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/calendar/v3/calendars/team%20calendar/events');
    expect(parsed.searchParams.get('singleEvents')).toBe('true');
    expect(parsed.searchParams.get('orderBy')).toBe('startTime');
    expect(parsed.searchParams.get('maxResults')).toBe('100');
    expect(parsed.searchParams.get('timeMin')).toBeTruthy();
    expect(out.ids).toEqual(['e1']);
  });

  it('always sends timeMin with startTime ordering even for pageToken-only calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const before = Date.now();
    await calendarListEvents('token-123', { pageToken: 'page-2' });
    const after = Date.now();
    const parsed = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(parsed.searchParams.get('pageToken')).toBe('page-2');
    expect(parsed.searchParams.get('orderBy')).toBe('startTime');
    // pageToken without query keeps the upcoming-list default (now), not a lookback.
    const timeMin = Date.parse(parsed.searchParams.get('timeMin')!);
    expect(timeMin).toBeGreaterThanOrEqual(before - 1000);
    expect(timeMin).toBeLessThanOrEqual(after + 1000);
  });

  it('uses a lookback timeMin for query-only historical search', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await calendarListEvents('token-123', { query: 'standup' });
    const parsed = new URL(fetchMock.mock.calls[0]![0] as string);
    const timeMin = Date.parse(parsed.searchParams.get('timeMin')!);
    expect(timeMin).toBeLessThan(Date.now() - 100 * 24 * 60 * 60 * 1000);
  });

  it('keeps a valid window when only a past timeMax is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await calendarListEvents('token-123', { timeMax: '2024-01-01T00:00:00Z' });
    const parsed = new URL(fetchMock.mock.calls[0]![0] as string);
    const timeMin = Date.parse(parsed.searchParams.get('timeMin')!);
    const timeMax = Date.parse(parsed.searchParams.get('timeMax')!);
    expect(timeMin).toBeLessThan(timeMax);
  });

  it('creates all-day events with date fields instead of dateTime fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'event-1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await calendarCreateEvent('token-123', {
      summary: 'Holiday',
      start: '2026-12-25',
      end: '2026-12-26',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      start: { date: '2026-12-25' },
      end: { date: '2026-12-26' },
    });
  });

  it('creates timed events with attendees and sendUpdates', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'event-2' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await calendarCreateEvent('token-123', {
      summary: 'Sync',
      start: '2026-08-04T15:00:00+08:00',
      end: '2026-08-04T16:00:00+08:00',
      timeZone: 'Asia/Shanghai',
      attendees: ['a@example.com', 'b@example.com'],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('sendUpdates=all');
    expect(JSON.parse(String(init.body))).toMatchObject({
      attendees: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
    });
  });

  it('returns the original event id after a successful delete', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      calendarDeleteEvent('token-123', { calendarId: 'primary', eventId: 'event/with space' }),
    ).resolves.toEqual({ ok: true, eventId: 'event/with space' });

    expect(fetchMock.mock.calls[0]?.[0]).toContain('event%2Fwith%20space');
  });

  it('quickAdds via the quickAdd endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'qa-1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await calendarQuickAdd('token-123', { text: 'Lunch tomorrow 12pm' });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/events/quickAdd?');
    expect(url).toContain('text=Lunch');
  });

  it('deletes by query across pages and notifies attendees', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (String(init?.method || 'GET').toUpperCase() === 'DELETE') {
        expect(String(url)).toContain('sendUpdates=all');
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (String(url).includes('pageToken=p2')) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [{ id: 'e2', summary: 'B' }] }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: [{ id: 'e1', summary: 'A' }],
            nextPageToken: 'p2',
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await calendarDeleteByQuery('token-123', {
      query: 'standup',
      timeMin: '2026-08-03T00:00:00Z',
      timeMax: '2026-08-10T00:00:00Z',
    });
    expect(out).toMatchObject({ ok: true, deleted: 2, requested: 2, truncated: false });
    expect(out.sample.map((r) => r.eventId)).toEqual(['e1', 'e2']);
  });

  it('refuses delete-by-query without a time window', async () => {
    await expect(
      calendarDeleteByQuery('token-123', { query: 'standup' }),
    ).rejects.toThrow('timeMin and timeMax are required');
  });

  it('finds multiple free slots inside a long open window', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          calendars: {
            primary: {
              busy: [
                {
                  start: '2026-08-04T02:00:00Z', // 10:00 Asia/Shanghai
                  end: '2026-08-04T03:00:00Z', // 11:00
                },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await calendarFindFreeSlots('token-123', {
      timeMin: '2026-08-04T01:00:00Z', // 09:00 Shanghai
      timeMax: '2026-08-04T09:00:00Z', // 17:00 Shanghai
      durationMinutes: 60,
      timeZone: 'Asia/Shanghai',
      workStartHour: 9,
      workEndHour: 17,
      maxSlots: 5,
    });
    // 09-10, then 11-12, 12-13, 13-14, 14-15 (capped at 5)
    expect(out.count).toBe(5);
    expect(out.slots[0]?.start).toBe('2026-08-04T01:00:00.000Z');
    expect(out.slots[0]?.startLocal).toBe('2026-08-04T09:00:00');
    expect(out.slots[1]?.start).toBe('2026-08-04T03:00:00.000Z');
    expect(out.slots[1]?.startLocal).toBe('2026-08-04T11:00:00');
  });

  it('fails free-slot search when freeBusy reports calendar errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            calendars: {
              primary: { errors: [{ reason: 'notFound' }] },
            },
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      calendarFindFreeSlots('token-123', {
        timeMin: '2026-08-04T01:00:00Z',
        timeMax: '2026-08-04T09:00:00Z',
        durationMinutes: 30,
      }),
    ).rejects.toThrow(/notFound/);
  });

  it('rsvps by patching the self attendee', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'ev',
            attendees: [
              { email: 'me@example.com', self: true, responseStatus: 'needsAction' },
              { email: 'other@example.com', responseStatus: 'accepted' },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'ev' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await calendarRsvp('token-123', { eventId: 'ev', response: 'accepted' });
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('sendUpdates=all');
    expect(JSON.parse(String(init.body))).toMatchObject({
      attendees: [
        { email: 'me@example.com', self: true, responseStatus: 'accepted' },
        { email: 'other@example.com', responseStatus: 'accepted' },
      ],
    });
  });
});
