import {
  CALENDAR_API,
  googleGetJson,
  googleSendJson,
  type GoogleRestJson,
} from '@/lib/integrations/google/client';

export async function calendarListCalendars(accessToken: string) {
  return googleGetJson(`${CALENDAR_API}/users/me/calendarList?maxResults=50`, accessToken);
}

export async function calendarListEvents(
  accessToken: string,
  opts: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    query?: string;
    maxResults?: number;
  },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(Math.min(Math.max(opts.maxResults || 20, 1), 50)),
  });
  if (opts.timeMin) params.set('timeMin', opts.timeMin);
  if (opts.timeMax) params.set('timeMax', opts.timeMax);
  if (opts.query) params.set('q', opts.query);
  if (!opts.timeMin && !opts.query) {
    params.set('timeMin', new Date().toISOString());
  }
  return googleGetJson(
    `${CALENDAR_API}/calendars/${calendarId}/events?${params.toString()}`,
    accessToken,
  );
}

export async function calendarCreateEvent(
  accessToken: string,
  opts: {
    calendarId?: string;
    summary: string;
    description?: string;
    location?: string;
    start: string;
    end: string;
    timeZone?: string;
  },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const tz = opts.timeZone || 'UTC';
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(opts.start) && /^\d{4}-\d{2}-\d{2}$/.test(opts.end);
  const body = {
    summary: opts.summary,
    description: opts.description,
    location: opts.location,
    start: allDay ? { date: opts.start } : { dateTime: opts.start, timeZone: tz },
    end: allDay ? { date: opts.end } : { dateTime: opts.end, timeZone: tz },
  };
  return googleSendJson(
    `${CALENDAR_API}/calendars/${calendarId}/events`,
    accessToken,
    'POST',
    body,
  );
}

export async function calendarUpdateEvent(
  accessToken: string,
  opts: {
    calendarId?: string;
    eventId: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: string;
    end?: string;
    timeZone?: string;
  },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const eventId = encodeURIComponent(opts.eventId);
  const tz = opts.timeZone || 'UTC';
  const patch: GoogleRestJson = {};
  if (opts.summary !== undefined) patch.summary = opts.summary;
  if (opts.description !== undefined) patch.description = opts.description;
  if (opts.location !== undefined) patch.location = opts.location;
  if (opts.start) {
    const allDay = /^\d{4}-\d{2}-\d{2}$/.test(opts.start);
    patch.start = allDay ? { date: opts.start } : { dateTime: opts.start, timeZone: tz };
  }
  if (opts.end) {
    const allDay = /^\d{4}-\d{2}-\d{2}$/.test(opts.end);
    patch.end = allDay ? { date: opts.end } : { dateTime: opts.end, timeZone: tz };
  }
  return googleSendJson(
    `${CALENDAR_API}/calendars/${calendarId}/events/${eventId}`,
    accessToken,
    'PATCH',
    patch,
  );
}

export async function calendarDeleteEvent(
  accessToken: string,
  opts: { calendarId?: string; eventId: string },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const eventId = encodeURIComponent(opts.eventId);
  await googleSendJson(
    `${CALENDAR_API}/calendars/${calendarId}/events/${eventId}`,
    accessToken,
    'DELETE',
  );
  return { ok: true, eventId: opts.eventId };
}

export async function calendarGetEvent(
  accessToken: string,
  opts: { calendarId?: string; eventId: string },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const eventId = encodeURIComponent(opts.eventId);
  return googleGetJson(
    `${CALENDAR_API}/calendars/${calendarId}/events/${eventId}`,
    accessToken,
  );
}

/** Move an event to another calendar. */
export async function calendarMoveEvent(
  accessToken: string,
  opts: { calendarId?: string; eventId: string; destinationCalendarId: string },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const eventId = encodeURIComponent(opts.eventId);
  const destination = encodeURIComponent(opts.destinationCalendarId);
  return googleSendJson(
    `${CALENDAR_API}/calendars/${calendarId}/events/${eventId}/move?destination=${destination}`,
    accessToken,
    'POST',
  );
}

/** Query free/busy for one or more calendars in a time window. */
export async function calendarFreeBusy(
  accessToken: string,
  opts: {
    timeMin: string;
    timeMax: string;
    calendarIds?: string[];
    timeZone?: string;
  },
) {
  const ids = (opts.calendarIds && opts.calendarIds.length
    ? opts.calendarIds
    : ['primary']
  ).map((id) => String(id || '').trim()).filter(Boolean);
  return googleSendJson(`${CALENDAR_API}/freeBusy`, accessToken, 'POST', {
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    timeZone: opts.timeZone || 'UTC',
    items: ids.map((id) => ({ id })),
  });
}

/** Expand instances of a recurring event. */
export async function calendarListEventInstances(
  accessToken: string,
  opts: {
    calendarId?: string;
    eventId: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
  },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const eventId = encodeURIComponent(opts.eventId);
  const params = new URLSearchParams({
    maxResults: String(Math.min(Math.max(opts.maxResults || 20, 1), 50)),
  });
  if (opts.timeMin) params.set('timeMin', opts.timeMin);
  if (opts.timeMax) params.set('timeMax', opts.timeMax);
  return googleGetJson(
    `${CALENDAR_API}/calendars/${calendarId}/events/${eventId}/instances?${params.toString()}`,
    accessToken,
  );
}

export async function calendarCreateCalendar(
  accessToken: string,
  opts: { summary: string; description?: string; timeZone?: string },
) {
  return googleSendJson(`${CALENDAR_API}/calendars`, accessToken, 'POST', {
    summary: opts.summary,
    description: opts.description,
    timeZone: opts.timeZone || 'UTC',
  });
}

export async function calendarListAcl(
  accessToken: string,
  opts: { calendarId?: string } = {},
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  return googleGetJson(
    `${CALENDAR_API}/calendars/${calendarId}/acl?maxResults=100`,
    accessToken,
  );
}

export async function calendarInsertAcl(
  accessToken: string,
  opts: {
    calendarId?: string;
    role: 'none' | 'freeBusyReader' | 'reader' | 'writer' | 'owner';
    scopeType: 'default' | 'user' | 'group' | 'domain';
    scopeValue?: string;
  },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const body: GoogleRestJson = {
    role: opts.role,
    scope: { type: opts.scopeType },
  };
  if (opts.scopeValue) (body.scope as GoogleRestJson).value = opts.scopeValue;
  return googleSendJson(
    `${CALENDAR_API}/calendars/${calendarId}/acl`,
    accessToken,
    'POST',
    body,
  );
}

export async function calendarDeleteAcl(
  accessToken: string,
  opts: { calendarId?: string; ruleId: string },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  await googleSendJson(
    `${CALENDAR_API}/calendars/${calendarId}/acl/${encodeURIComponent(opts.ruleId)}`,
    accessToken,
    'DELETE',
  );
  return { ok: true, deleted: opts.ruleId };
}
