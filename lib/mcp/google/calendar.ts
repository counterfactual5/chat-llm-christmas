import {
  calendarCreateCalendar,
  calendarCreateEvent,
  calendarDeleteAcl,
  calendarDeleteByQuery,
  calendarDeleteEvent,
  calendarFindFreeSlots,
  calendarFreeBusy,
  calendarGetEvent,
  calendarInsertAcl,
  calendarListAcl,
  calendarListCalendars,
  calendarListEventInstances,
  calendarListEvents,
  calendarMoveEvent,
  calendarQuickAdd,
  calendarRsvp,
  calendarUpdateEvent,
} from '@/lib/integrations/google/calendar';
import { num, str, type GoogleToolDef } from '@/lib/mcp/google/shared';

export const calendarToolDefs: GoogleToolDef[] = [
  {
    name: 'calendar_list_calendars',
    description: 'List calendars available to the connected Google account.',
    parameters: { type: 'object', properties: {} },
    run: async (token) => calendarListCalendars(token),
  },
  {
    name: 'calendar_create_calendar',
    description: 'Create a secondary Google Calendar.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Calendar title' },
        description: { type: 'string' },
        timeZone: { type: 'string' },
      },
      required: ['summary'],
    },
    run: async (token, args) => {
      const summary = str(args.summary);
      if (!summary) throw new Error('summary is required');
      return calendarCreateCalendar(token, {
        summary,
        description: str(args.description) || undefined,
        timeZone: str(args.timeZone) || undefined,
      });
    },
  },
  {
    name: 'calendar_list_acl',
    description: 'List ACL rules (who can access a calendar).',
    parameters: {
      type: 'object',
      properties: {
        calendarId: { type: 'string', description: 'Default primary' },
      },
    },
    run: async (token, args) =>
      calendarListAcl(token, { calendarId: str(args.calendarId) || undefined }),
  },
  {
    name: 'calendar_insert_acl',
    description:
      'Share a calendar. role: none|freeBusyReader|reader|writer|owner. For type=user provide email.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        calendarId: { type: 'string' },
        role: { type: 'string' },
        type: { type: 'string', description: 'user | group | domain | default' },
        email: { type: 'string' },
        domain: { type: 'string' },
      },
      required: ['role', 'type'],
    },
    run: async (token, args) => {
      const role = str(args.role) as
        | 'none'
        | 'freeBusyReader'
        | 'reader'
        | 'writer'
        | 'owner';
      const scopeType = str(args.type) as 'user' | 'group' | 'domain' | 'default';
      if (!role || !scopeType) throw new Error('role and type are required');
      if (!['none', 'freeBusyReader', 'reader', 'writer', 'owner'].includes(role)) {
        throw new Error('role must be none, freeBusyReader, reader, writer, or owner');
      }
      if (!['user', 'group', 'domain', 'default'].includes(scopeType)) {
        throw new Error('type must be user, group, domain, or default');
      }
      const scopeValue =
        str(args.email) || str(args.domain) || str(args.scopeValue) || undefined;
      if ((scopeType === 'user' || scopeType === 'group') && !scopeValue) {
        throw new Error('email is required for type=user|group');
      }
      if (scopeType === 'domain' && !scopeValue) {
        throw new Error('domain is required for type=domain');
      }
      return calendarInsertAcl(token, {
        calendarId: str(args.calendarId) || undefined,
        role,
        scopeType,
        scopeValue,
      });
    },
  },
  {
    name: 'calendar_delete_acl',
    description: 'Remove a calendar ACL rule by ruleId (from calendar_list_acl).',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        calendarId: { type: 'string' },
        ruleId: { type: 'string' },
      },
      required: ['ruleId'],
    },
    run: async (token, args) => {
      const ruleId = str(args.ruleId);
      if (!ruleId) throw new Error('ruleId is required');
      return calendarDeleteAcl(token, {
        calendarId: str(args.calendarId) || undefined,
        ruleId,
      });
    },
  },
  {
    name: 'calendar_list_events',
    description:
      'List calendar events (paginated). Defaults to primary calendar from now. Returns items plus ids[] and effectiveTimeMin. When paginating, always re-pass the same timeMin/timeMax/query with pageToken (use effectiveTimeMin from the prior response). If timeMin is omitted: upcoming list defaults to now; query defaults to a 2-year lookback.',
    parameters: {
      type: 'object',
      properties: {
        calendarId: { type: 'string', description: 'Default primary' },
        timeMin: {
          type: 'string',
          description: 'RFC3339 start lower bound (re-pass on pagination; default now or 2y lookback with query)',
        },
        timeMax: { type: 'string', description: 'RFC3339 start upper bound' },
        query: { type: 'string', description: 'Free-text event search' },
        maxResults: { type: 'integer', description: '1-250, default 20' },
        pageToken: { type: 'string' },
      },
    },
    run: async (token, args, fallback) =>
      calendarListEvents(token, {
        calendarId: str(args.calendarId) || undefined,
        timeMin: str(args.timeMin) || undefined,
        timeMax: str(args.timeMax) || undefined,
        query: str(args.query) || fallback || undefined,
        maxResults: num(args.maxResults, 20),
        pageToken: str(args.pageToken) || undefined,
      }),
  },
  {
    name: 'calendar_create_event',
    description:
      'Create a calendar event. start/end are RFC3339 date-times, or YYYY-MM-DD for all-day. Optional attendees emails send invites (sendUpdates=all by default when attendees present). Prefer calendar_quick_add for casual natural-language scheduling.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        calendarId: { type: 'string' },
        summary: { type: 'string' },
        description: { type: 'string' },
        location: { type: 'string' },
        start: { type: 'string' },
        end: { type: 'string' },
        timeZone: { type: 'string', description: 'e.g. Asia/Shanghai' },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Invitee email addresses',
        },
        sendUpdates: {
          type: 'string',
          description: 'all | externalOnly | none (default all when attendees set)',
        },
      },
      required: ['summary', 'start', 'end'],
    },
    run: async (token, args) => {
      const summary = str(args.summary);
      const start = str(args.start);
      const end = str(args.end);
      if (!summary || !start || !end) throw new Error('summary, start, and end are required');
      const attendees = Array.isArray(args.attendees)
        ? args.attendees.map((x) => str(x)).filter(Boolean)
        : undefined;
      const sendUpdatesRaw = str(args.sendUpdates);
      const sendUpdates =
        sendUpdatesRaw === 'all' ||
        sendUpdatesRaw === 'externalOnly' ||
        sendUpdatesRaw === 'none'
          ? sendUpdatesRaw
          : undefined;
      return calendarCreateEvent(token, {
        calendarId: str(args.calendarId) || undefined,
        summary,
        description: str(args.description) || undefined,
        location: str(args.location) || undefined,
        start,
        end,
        timeZone: str(args.timeZone) || undefined,
        attendees,
        sendUpdates,
      });
    },
  },
  {
    name: 'calendar_quick_add',
    description:
      'Create an event from natural language via Google Calendar quickAdd. Example text: "Lunch with Sam tomorrow 12pm". Prefer for casual scheduling; use calendar_create_event for precise times/attendees.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Natural language event description' },
        calendarId: { type: 'string' },
      },
      required: ['text'],
    },
    run: async (token, args) => {
      const text = str(args.text);
      if (!text) throw new Error('text is required');
      return calendarQuickAdd(token, {
        text,
        calendarId: str(args.calendarId) || undefined,
      });
    },
  },
  {
    name: 'calendar_update_event',
    description:
      'Update an existing calendar event by eventId. Can replace attendees list (emails) and sendUpdates.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        calendarId: { type: 'string' },
        eventId: { type: 'string' },
        summary: { type: 'string' },
        description: { type: 'string' },
        location: { type: 'string' },
        start: { type: 'string' },
        end: { type: 'string' },
        timeZone: { type: 'string' },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replacement invitee emails',
        },
        sendUpdates: {
          type: 'string',
          description: 'all | externalOnly | none',
        },
      },
      required: ['eventId'],
    },
    run: async (token, args) => {
      const eventId = str(args.eventId);
      if (!eventId) throw new Error('eventId is required');
      const attendees = Array.isArray(args.attendees)
        ? args.attendees.map((x) => str(x)).filter(Boolean)
        : undefined;
      const sendUpdatesRaw = str(args.sendUpdates);
      const sendUpdates =
        sendUpdatesRaw === 'all' ||
        sendUpdatesRaw === 'externalOnly' ||
        sendUpdatesRaw === 'none'
          ? sendUpdatesRaw
          : undefined;
      return calendarUpdateEvent(token, {
        calendarId: str(args.calendarId) || undefined,
        eventId,
        summary: str(args.summary) || undefined,
        description: str(args.description) || undefined,
        location: str(args.location) || undefined,
        start: str(args.start) || undefined,
        end: str(args.end) || undefined,
        timeZone: str(args.timeZone) || undefined,
        attendees,
        sendUpdates,
      });
    },
  },
  {
    name: 'calendar_delete_event',
    description:
      'Delete a calendar event by eventId. sendUpdates defaults to all so attendees are notified; pass none to suppress.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        calendarId: { type: 'string' },
        eventId: { type: 'string' },
        sendUpdates: {
          type: 'string',
          description: 'all | externalOnly | none (default all)',
        },
      },
      required: ['eventId'],
    },
    run: async (token, args) => {
      const eventId = str(args.eventId);
      if (!eventId) throw new Error('eventId is required');
      const sendUpdatesRaw = str(args.sendUpdates);
      const sendUpdates =
        sendUpdatesRaw === 'all' ||
        sendUpdatesRaw === 'externalOnly' ||
        sendUpdatesRaw === 'none'
          ? sendUpdatesRaw
          : 'all';
      return calendarDeleteEvent(token, {
        calendarId: str(args.calendarId) || undefined,
        eventId,
        sendUpdates,
      });
    },
  },
  {
    name: 'calendar_delete_by_query',
    description:
      'Delete matching events in a time window (paginated). Requires timeMin+timeMax and confirm=true; query strongly recommended (without query maxTotal caps at 20). Notifies attendees (sendUpdates=all) by default.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        calendarId: { type: 'string' },
        query: { type: 'string', description: 'Recommended free-text filter' },
        timeMin: { type: 'string', description: 'RFC3339 lower bound (required)' },
        timeMax: { type: 'string', description: 'RFC3339 upper bound (required)' },
        maxTotal: {
          type: 'integer',
          description: 'Max events (with query: 1-500 default 50; without: max 20)',
        },
        sendUpdates: {
          type: 'string',
          description: 'all | externalOnly | none (default all)',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to proceed (safety latch)',
        },
      },
      required: ['timeMin', 'timeMax', 'confirm'],
    },
    run: async (token, args) => {
      if (args.confirm !== true) {
        throw new Error('confirm=true is required for calendar_delete_by_query');
      }
      const query = str(args.query) || undefined;
      const timeMin = str(args.timeMin);
      const timeMax = str(args.timeMax);
      if (!timeMin || !timeMax) {
        throw new Error('timeMin and timeMax are required');
      }
      const maxTotal =
        typeof args.maxTotal === 'number' && Number.isFinite(args.maxTotal)
          ? args.maxTotal
          : undefined;
      const sendUpdatesRaw = str(args.sendUpdates);
      const sendUpdates =
        sendUpdatesRaw === 'all' ||
        sendUpdatesRaw === 'externalOnly' ||
        sendUpdatesRaw === 'none'
          ? sendUpdatesRaw
          : undefined;
      return calendarDeleteByQuery(token, {
        calendarId: str(args.calendarId) || undefined,
        query,
        timeMin,
        timeMax,
        maxTotal,
        sendUpdates,
      });
    },
  },
  {
    name: 'calendar_find_free_slots',
    description:
      'Suggest free meeting slots from free/busy. Provide timeMin/timeMax, durationMinutes. Defaults to work hours 9–17 in timeZone. Each slot includes UTC start/end plus startLocal/endLocal in that timeZone — prefer local fields when creating events.',
    parameters: {
      type: 'object',
      properties: {
        timeMin: { type: 'string' },
        timeMax: { type: 'string' },
        durationMinutes: { type: 'integer', description: 'Meeting length in minutes' },
        calendarIds: { type: 'array', items: { type: 'string' } },
        timeZone: { type: 'string' },
        workStartHour: { type: 'integer', description: 'Default 9' },
        workEndHour: { type: 'integer', description: 'Default 17' },
        maxSlots: { type: 'integer', description: 'Default 10' },
      },
      required: ['timeMin', 'timeMax', 'durationMinutes'],
    },
    run: async (token, args) => {
      const timeMin = str(args.timeMin);
      const timeMax = str(args.timeMax);
      if (!timeMin || !timeMax) throw new Error('timeMin and timeMax are required');
      const durationMinutes =
        typeof args.durationMinutes === 'number' && Number.isFinite(args.durationMinutes)
          ? args.durationMinutes
          : num(args.durationMinutes, 30);
      const calendarIds = Array.isArray(args.calendarIds)
        ? args.calendarIds.map((x) => str(x)).filter(Boolean)
        : undefined;
      return calendarFindFreeSlots(token, {
        timeMin,
        timeMax,
        durationMinutes,
        calendarIds,
        timeZone: str(args.timeZone) || undefined,
        workStartHour:
          args.workStartHour === undefined ? undefined : num(args.workStartHour, 9),
        workEndHour: args.workEndHour === undefined ? undefined : num(args.workEndHour, 17),
        maxSlots: args.maxSlots === undefined ? undefined : num(args.maxSlots, 10),
      });
    },
  },
  {
    name: 'calendar_rsvp',
    description:
      'Respond to a calendar invitation: accepted | declined | tentative. Requires you are an attendee on the event.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        calendarId: { type: 'string' },
        eventId: { type: 'string' },
        response: {
          type: 'string',
          description: 'accepted | declined | tentative',
        },
        sendUpdates: {
          type: 'string',
          description: 'all | externalOnly | none (default all)',
        },
      },
      required: ['eventId', 'response'],
    },
    run: async (token, args) => {
      const eventId = str(args.eventId);
      const response = str(args.response) as 'accepted' | 'declined' | 'tentative';
      if (!eventId || !response) throw new Error('eventId and response are required');
      if (!['accepted', 'declined', 'tentative'].includes(response)) {
        throw new Error('response must be accepted, declined, or tentative');
      }
      const sendUpdatesRaw = str(args.sendUpdates);
      const sendUpdates =
        sendUpdatesRaw === 'all' ||
        sendUpdatesRaw === 'externalOnly' ||
        sendUpdatesRaw === 'none'
          ? sendUpdatesRaw
          : undefined;
      return calendarRsvp(token, {
        calendarId: str(args.calendarId) || undefined,
        eventId,
        response,
        sendUpdates,
      });
    },
  },
  {
    name: 'calendar_get_event',
    description: 'Get a single calendar event by eventId.',
    parameters: {
      type: 'object',
      properties: {
        calendarId: { type: 'string' },
        eventId: { type: 'string' },
      },
      required: ['eventId'],
    },
    run: async (token, args) => {
      const eventId = str(args.eventId);
      if (!eventId) throw new Error('eventId is required');
      return calendarGetEvent(token, {
        calendarId: str(args.calendarId) || undefined,
        eventId,
      });
    },
  },
  {
    name: 'calendar_move_event',
    description: 'Move an event to another calendar (destinationCalendarId).',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        calendarId: { type: 'string', description: 'Source calendar, default primary' },
        eventId: { type: 'string' },
        destinationCalendarId: { type: 'string' },
      },
      required: ['eventId', 'destinationCalendarId'],
    },
    run: async (token, args) => {
      const eventId = str(args.eventId);
      const destinationCalendarId = str(args.destinationCalendarId);
      if (!eventId || !destinationCalendarId) {
        throw new Error('eventId and destinationCalendarId are required');
      }
      return calendarMoveEvent(token, {
        calendarId: str(args.calendarId) || undefined,
        eventId,
        destinationCalendarId,
      });
    },
  },
  {
    name: 'calendar_freebusy',
    description:
      'Query free/busy for calendars between timeMin and timeMax (RFC3339). Defaults to primary calendar. Prefer calendar_find_free_slots when you need suggested open windows.',
    parameters: {
      type: 'object',
      properties: {
        timeMin: { type: 'string' },
        timeMax: { type: 'string' },
        calendarIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Calendar ids; default ["primary"]',
        },
        timeZone: { type: 'string' },
      },
      required: ['timeMin', 'timeMax'],
    },
    run: async (token, args) => {
      const timeMin = str(args.timeMin);
      const timeMax = str(args.timeMax);
      if (!timeMin || !timeMax) throw new Error('timeMin and timeMax are required');
      const calendarIds = Array.isArray(args.calendarIds)
        ? args.calendarIds.map((x) => str(x)).filter(Boolean)
        : undefined;
      return calendarFreeBusy(token, {
        timeMin,
        timeMax,
        calendarIds,
        timeZone: str(args.timeZone) || undefined,
      });
    },
  },
  {
    name: 'calendar_list_instances',
    description:
      'List instances of a recurring calendar event by eventId (optionally bounded by timeMin/timeMax).',
    parameters: {
      type: 'object',
      properties: {
        calendarId: { type: 'string' },
        eventId: { type: 'string' },
        timeMin: { type: 'string' },
        timeMax: { type: 'string' },
        maxResults: { type: 'integer' },
      },
      required: ['eventId'],
    },
    run: async (token, args) => {
      const eventId = str(args.eventId);
      if (!eventId) throw new Error('eventId is required');
      return calendarListEventInstances(token, {
        calendarId: str(args.calendarId) || undefined,
        eventId,
        timeMin: str(args.timeMin) || undefined,
        timeMax: str(args.timeMax) || undefined,
        maxResults: num(args.maxResults, 20),
      });
    },
  },
];
