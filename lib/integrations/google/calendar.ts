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
    pageToken?: string;
  },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(Math.min(Math.max(opts.maxResults || 20, 1), 250)),
  });
  // orderBy=startTime requires timeMin. Prefer explicit timeMin; otherwise:
  // - with query → wide lookback so historical search is not emptied
  // - otherwise (upcoming list, or pageToken continuation without query) → now
  // Pagination must re-pass the same timeMin (see effectiveTimeMin); pageToken alone
  // must NOT switch from now → lookback or the window drifts.
  const explicitMin = String(opts.timeMin || '').trim();
  const explicitMax = String(opts.timeMax || '').trim();
  const query = String(opts.query || '').trim();
  let timeMin = explicitMin;
  if (!timeMin) {
    const now = Date.now();
    if (query) {
      timeMin = new Date(now - 2 * 365 * 24 * 60 * 60 * 1000).toISOString();
    } else {
      timeMin = new Date(now).toISOString();
    }
  }
  if (explicitMax) {
    const maxMs = Date.parse(explicitMax);
    const minMs = Date.parse(timeMin);
    if (Number.isFinite(maxMs) && Number.isFinite(minMs) && minMs >= maxMs) {
      // Keep a valid window ending at timeMax (e.g. historical timeMax-only calls).
      timeMin = new Date(maxMs - 2 * 365 * 24 * 60 * 60 * 1000).toISOString();
    }
    params.set('timeMax', explicitMax);
  }
  params.set('timeMin', timeMin);
  if (query) params.set('q', query);
  if (opts.pageToken) params.set('pageToken', opts.pageToken);
  const list = await googleGetJson(
    `${CALENDAR_API}/calendars/${calendarId}/events?${params.toString()}`,
    accessToken,
  );
  const items = Array.isArray(list.items) ? (list.items as Array<GoogleRestJson>) : [];
  const ids = items
    .map((item) => String(item.id || '').trim())
    .filter(Boolean);
  return {
    ...list,
    ids,
    /** Effective timeMin sent to the API (echo for pagination). */
    effectiveTimeMin: timeMin,
  } as GoogleRestJson & { ids: string[]; effectiveTimeMin: string };
}

/** Paginate event listing and collect ids (+ light summaries). */
export async function calendarListEventIds(
  accessToken: string,
  opts: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    query?: string;
    maxTotal?: number;
  },
) {
  const query = String(opts.query || '').trim();
  const timeMin = String(opts.timeMin || '').trim();
  const timeMax = String(opts.timeMax || '').trim();
  if (!timeMin || !timeMax) {
    throw new Error('timeMin and timeMax are required to scope which events are affected');
  }
  if (Date.parse(timeMax) <= Date.parse(timeMin)) {
    throw new Error('timeMax must be after timeMin');
  }
  const maxTotal = Math.min(Math.max(opts.maxTotal || 100, 1), 500);
  const events: Array<{ id: string; summary?: string; start?: string; htmlLink?: string }> = [];
  let pageToken: string | undefined;
  let pages = 0;
  let truncated = false;

  while (events.length < maxTotal) {
    const list = await calendarListEvents(accessToken, {
      calendarId: opts.calendarId,
      timeMin: timeMin || undefined,
      timeMax: timeMax || undefined,
      query: query || undefined,
      maxResults: Math.min(100, maxTotal - events.length),
      pageToken,
    });
    pages += 1;
    const items = Array.isArray(list.items) ? (list.items as Array<GoogleRestJson>) : [];
    for (const item of items) {
      const id = String(item.id || '').trim();
      if (!id) continue;
      if (events.length >= maxTotal) {
        truncated = true;
        break;
      }
      const startObj = (item.start || {}) as GoogleRestJson;
      events.push({
        id,
        summary: item.summary != null ? String(item.summary) : undefined,
        start:
          startObj.dateTime != null
            ? String(startObj.dateTime)
            : startObj.date != null
              ? String(startObj.date)
              : undefined,
        htmlLink: item.htmlLink != null ? String(item.htmlLink) : undefined,
      });
    }
    const next = String(list.nextPageToken || '').trim();
    if (!next || !items.length) break;
    if (events.length >= maxTotal) {
      truncated = true;
      break;
    }
    pageToken = next;
    if (pages >= 20) {
      truncated = true;
      break;
    }
  }

  return {
    calendarId: opts.calendarId || 'primary',
    query,
    timeMin,
    timeMax,
    events,
    ids: events.map((e) => e.id),
    count: events.length,
    pages,
    truncated,
  };
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
    attendees?: string[];
    sendUpdates?: 'all' | 'externalOnly' | 'none';
  },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const tz = opts.timeZone || 'UTC';
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(opts.start) && /^\d{4}-\d{2}-\d{2}$/.test(opts.end);
  const body: GoogleRestJson = {
    summary: opts.summary,
    description: opts.description,
    location: opts.location,
    start: allDay ? { date: opts.start } : { dateTime: opts.start, timeZone: tz },
    end: allDay ? { date: opts.end } : { dateTime: opts.end, timeZone: tz },
  };
  const attendees = (opts.attendees || [])
    .map((email) => String(email || '').trim())
    .filter(Boolean)
    .map((email) => ({ email }));
  if (attendees.length) body.attendees = attendees;
  const params = new URLSearchParams();
  if (opts.sendUpdates) params.set('sendUpdates', opts.sendUpdates);
  else if (attendees.length) params.set('sendUpdates', 'all');
  const qs = params.toString();
  return googleSendJson(
    `${CALENDAR_API}/calendars/${calendarId}/events${qs ? `?${qs}` : ''}`,
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
    attendees?: string[];
    sendUpdates?: 'all' | 'externalOnly' | 'none';
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
  if (opts.attendees) {
    patch.attendees = opts.attendees
      .map((email) => String(email || '').trim())
      .filter(Boolean)
      .map((email) => ({ email }));
  }
  const params = new URLSearchParams();
  if (opts.sendUpdates) params.set('sendUpdates', opts.sendUpdates);
  else if (opts.attendees?.length) params.set('sendUpdates', 'all');
  const qs = params.toString();
  return googleSendJson(
    `${CALENDAR_API}/calendars/${calendarId}/events/${eventId}${qs ? `?${qs}` : ''}`,
    accessToken,
    'PATCH',
    patch,
  );
}

export async function calendarDeleteEvent(
  accessToken: string,
  opts: {
    calendarId?: string;
    eventId: string;
    sendUpdates?: 'all' | 'externalOnly' | 'none';
  },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const eventId = encodeURIComponent(opts.eventId);
  const params = new URLSearchParams();
  if (opts.sendUpdates) params.set('sendUpdates', opts.sendUpdates);
  const qs = params.toString();
  await googleSendJson(
    `${CALENDAR_API}/calendars/${calendarId}/events/${eventId}${qs ? `?${qs}` : ''}`,
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

/** Delete events matching a required time window (paginated). Query recommended. */
export async function calendarDeleteByQuery(
  accessToken: string,
  opts: {
    calendarId?: string;
    query?: string;
    timeMin?: string;
    timeMax?: string;
    maxTotal?: number;
    sendUpdates?: 'all' | 'externalOnly' | 'none';
  },
) {
  const query = String(opts.query || '').trim();
  // Without a query, keep the blast radius small.
  const defaultMax = query ? 50 : 20;
  const hardCap = query ? 500 : 20;
  const maxTotal = Math.min(Math.max(opts.maxTotal || defaultMax, 1), hardCap);
  const listed = await calendarListEventIds(accessToken, {
    calendarId: opts.calendarId,
    query: query || undefined,
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    maxTotal,
  });
  const results: Array<{ eventId: string; ok: boolean; error?: string; summary?: string }> = [];
  for (const event of listed.events) {
    try {
      await calendarDeleteEvent(accessToken, {
        calendarId: opts.calendarId,
        eventId: event.id,
        sendUpdates: opts.sendUpdates ?? 'all',
      });
      results.push({ eventId: event.id, ok: true, summary: event.summary });
    } catch (error) {
      results.push({
        eventId: event.id,
        ok: false,
        summary: event.summary,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const deleted = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  return {
    ok: true,
    calendarId: listed.calendarId,
    query: listed.query,
    timeMin: listed.timeMin,
    timeMax: listed.timeMax,
    requested: listed.count,
    deleted,
    failed: failed.length,
    truncated: listed.truncated,
    sendUpdates: opts.sendUpdates ?? 'all',
    sample: results.slice(0, 8),
    failedSample: failed.slice(0, 20),
  };
}

/** Create an event from natural language via Calendar quickAdd. */
export async function calendarQuickAdd(
  accessToken: string,
  opts: { text: string; calendarId?: string },
) {
  const text = String(opts.text || '').trim();
  if (!text) throw new Error('text is required');
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const params = new URLSearchParams({ text });
  return googleSendJson(
    `${CALENDAR_API}/calendars/${calendarId}/events/quickAdd?${params.toString()}`,
    accessToken,
    'POST',
  );
}

type BusyInterval = { startMs: number; endMs: number };

function parseInstant(value: unknown): number | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function mergeBusy(intervals: BusyInterval[]): BusyInterval[] {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const out: BusyInterval[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, cur.endMs);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

function clampToWorkHours(
  startMs: number,
  endMs: number,
  timeZone: string,
  workStartHour: number,
  workEndHour: number,
): BusyInterval[] {
  // Split [startMs, endMs) into per-day work-hour windows in the given timezone.
  const slots: BusyInterval[] = [];
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const partsOf = (ms: number) => {
    const parts = formatter.formatToParts(new Date(ms));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour'),
      minute: get('minute'),
      second: get('second'),
    };
  };

  // Walk day by day using UTC noon anchors adjusted via timezone offset estimation.
  let cursor = startMs;
  while (cursor < endMs) {
    const p = partsOf(cursor);
    // Build work window for this local day by finding UTC ms whose local time matches.
    const localDayKey = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    const guessUtcForLocal = (hour: number, minute = 0) => {
      // Approximate: take the UTC instant for local Y-M-D H:M by binary-searching offset.
      let guess = Date.UTC(p.year, p.month - 1, p.day, hour, minute, 0);
      for (let i = 0; i < 3; i += 1) {
        const local = partsOf(guess);
        const localAsUtc = Date.UTC(
          local.year,
          local.month - 1,
          local.day,
          local.hour,
          local.minute,
          local.second,
        );
        const targetAsUtc = Date.UTC(p.year, p.month - 1, p.day, hour, minute, 0);
        guess += targetAsUtc - localAsUtc;
      }
      return guess;
    };
    const dayWorkStart = guessUtcForLocal(workStartHour);
    const dayWorkEnd = guessUtcForLocal(workEndHour);
    const slotStart = Math.max(cursor, dayWorkStart);
    const slotEnd = Math.min(endMs, dayWorkEnd);
    if (slotEnd > slotStart) {
      slots.push({ startMs: slotStart, endMs: slotEnd });
    }
    // Advance to next local midnight roughly.
    const nextDayStart = guessUtcForLocal(24);
    if (!(nextDayStart > cursor)) break;
    // Avoid infinite loop if formatter weirdness — also key unused but keeps intent clear.
    void localDayKey;
    cursor = Math.max(nextDayStart, cursor + 1);
  }
  return slots;
}

/** Suggest free slots from freeBusy (duration minutes, optional work hours). */
export async function calendarFindFreeSlots(
  accessToken: string,
  opts: {
    timeMin: string;
    timeMax: string;
    durationMinutes: number;
    calendarIds?: string[];
    timeZone?: string;
    workStartHour?: number;
    workEndHour?: number;
    maxSlots?: number;
  },
) {
  const timeMinMs = parseInstant(opts.timeMin);
  const timeMaxMs = parseInstant(opts.timeMax);
  if (timeMinMs == null || timeMaxMs == null || timeMaxMs <= timeMinMs) {
    throw new Error('timeMin and timeMax must be valid RFC3339 with timeMax > timeMin');
  }
  const durationMs = Math.min(Math.max(Math.round(opts.durationMinutes || 0), 5), 24 * 60) * 60_000;
  const timeZone = opts.timeZone || 'UTC';
  const workStartHour =
    opts.workStartHour === undefined ? 9 : Math.min(Math.max(opts.workStartHour, 0), 23);
  const workEndHour =
    opts.workEndHour === undefined ? 17 : Math.min(Math.max(opts.workEndHour, 1), 24);
  if (workEndHour <= workStartHour) {
    throw new Error('workEndHour must be greater than workStartHour');
  }
  const maxSlots = Math.min(Math.max(opts.maxSlots || 10, 1), 50);

  const freeBusy = await calendarFreeBusy(accessToken, {
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    calendarIds: opts.calendarIds,
    timeZone,
  });

  const calendars = (freeBusy?.calendars || {}) as Record<string, GoogleRestJson>;
  const busy: BusyInterval[] = [];
  const calendarErrors: Array<{ calendarId: string; error: string }> = [];
  for (const [calendarId, cal] of Object.entries(calendars)) {
    const errs = Array.isArray(cal.errors) ? (cal.errors as Array<GoogleRestJson>) : [];
    if (errs.length) {
      calendarErrors.push({
        calendarId,
        error: errs
          .map((e) => String(e.reason || e.domain || e.message || 'unknown'))
          .join(', '),
      });
      continue;
    }
    const rows = Array.isArray(cal.busy) ? (cal.busy as Array<GoogleRestJson>) : [];
    for (const row of rows) {
      const startMs = parseInstant(row.start);
      const endMs = parseInstant(row.end);
      if (startMs == null || endMs == null || endMs <= startMs) continue;
      busy.push({ startMs, endMs });
    }
  }
  if (calendarErrors.length) {
    throw new Error(
      `freeBusy failed for calendar(s): ${calendarErrors
        .map((e) => `${e.calendarId} (${e.error})`)
        .join('; ')}`,
    );
  }
  const mergedBusy = mergeBusy(busy);
  const windows = clampToWorkHours(timeMinMs, timeMaxMs, timeZone, workStartHour, workEndHour);

  const localFormatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const formatLocal = (ms: number) => localFormatter.format(new Date(ms)).replace(' ', 'T');

  const slots: Array<{ start: string; end: string; startLocal: string; endLocal: string }> = [];
  const pushSlotsInRange = (from: number, to: number) => {
    let cursor = from;
    while (to - cursor >= durationMs && slots.length < maxSlots) {
      const end = cursor + durationMs;
      slots.push({
        start: new Date(cursor).toISOString(),
        end: new Date(end).toISOString(),
        startLocal: formatLocal(cursor),
        endLocal: formatLocal(end),
      });
      cursor += durationMs;
    }
  };

  for (const window of windows) {
    let cursor = window.startMs;
    const relevantBusy = mergedBusy.filter(
      (b) => b.endMs > window.startMs && b.startMs < window.endMs,
    );
    for (const block of relevantBusy) {
      const freeEnd = Math.min(block.startMs, window.endMs);
      pushSlotsInRange(cursor, freeEnd);
      if (slots.length >= maxSlots) break;
      cursor = Math.max(cursor, block.endMs);
    }
    if (slots.length >= maxSlots) break;
    pushSlotsInRange(cursor, window.endMs);
    if (slots.length >= maxSlots) break;
  }

  return {
    ok: true,
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    durationMinutes: durationMs / 60_000,
    timeZone,
    workStartHour,
    workEndHour,
    busyCount: mergedBusy.length,
    slots,
    count: slots.length,
    note: 'slots[].start/end are UTC ISO-8601; startLocal/endLocal use timeZone. Prefer local fields when creating events in that zone.',
  };
}

/** RSVP to an event invitation (accepted | declined | tentative). */
export async function calendarRsvp(
  accessToken: string,
  opts: {
    calendarId?: string;
    eventId: string;
    response: 'accepted' | 'declined' | 'tentative';
    sendUpdates?: 'all' | 'externalOnly' | 'none';
  },
) {
  const response = opts.response;
  if (!['accepted', 'declined', 'tentative'].includes(response)) {
    throw new Error('response must be accepted, declined, or tentative');
  }
  const event = await calendarGetEvent(accessToken, {
    calendarId: opts.calendarId,
    eventId: opts.eventId,
  });
  const attendees = Array.isArray(event.attendees)
    ? (event.attendees as Array<GoogleRestJson>).map((a) => ({ ...a }))
    : [];
  const selfIndex = attendees.findIndex((a) => a.self === true);
  if (selfIndex < 0) {
    throw new Error('You are not listed as an attendee on this event');
  }
  attendees[selfIndex] = { ...attendees[selfIndex], responseStatus: response };
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const eventId = encodeURIComponent(opts.eventId);
  const params = new URLSearchParams({
    sendUpdates: opts.sendUpdates || 'all',
  });
  return googleSendJson(
    `${CALENDAR_API}/calendars/${calendarId}/events/${eventId}?${params.toString()}`,
    accessToken,
    'PATCH',
    { attendees },
  );
}
