import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calendarCreateEvent,
  calendarDeleteEvent,
  calendarListEvents,
} from '@/lib/integrations/google/calendar';

describe('Google Calendar helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists upcoming events with Calendar defaults', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await calendarListEvents('token-123', { calendarId: 'team calendar', maxResults: 100 });

    const [url] = fetchMock.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/calendar/v3/calendars/team%20calendar/events');
    expect(parsed.searchParams.get('singleEvents')).toBe('true');
    expect(parsed.searchParams.get('orderBy')).toBe('startTime');
    expect(parsed.searchParams.get('maxResults')).toBe('50');
    expect(parsed.searchParams.get('timeMin')).toBeTruthy();
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

  it('returns the original event id after a successful delete', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      calendarDeleteEvent('token-123', { calendarId: 'primary', eventId: 'event/with space' }),
    ).resolves.toEqual({ ok: true, eventId: 'event/with space' });

    expect(fetchMock.mock.calls[0]?.[0]).toContain('event%2Fwith%20space');
  });
});
