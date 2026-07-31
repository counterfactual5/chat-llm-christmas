import {
  calendarCreateCalendar,
  calendarCreateEvent,
  calendarDeleteAcl,
  calendarDeleteEvent,
  calendarFreeBusy,
  calendarGetEvent,
  calendarInsertAcl,
  calendarListAcl,
  calendarListCalendars,
  calendarListEventInstances,
  calendarListEvents,
  calendarMoveEvent,
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
      'List upcoming calendar events. Defaults to primary calendar from now. Use ISO timestamps for timeMin/timeMax.',
    parameters: {
      type: 'object',
      properties: {
        calendarId: { type: 'string', description: 'Default primary' },
        timeMin: { type: 'string', description: 'RFC3339 start lower bound' },
        timeMax: { type: 'string', description: 'RFC3339 start upper bound' },
        query: { type: 'string', description: 'Free-text event search' },
        maxResults: { type: 'integer' },
      },
    },
    run: async (token, args, fallback) =>
      calendarListEvents(token, {
        calendarId: str(args.calendarId) || undefined,
        timeMin: str(args.timeMin) || undefined,
        timeMax: str(args.timeMax) || undefined,
        query: str(args.query) || fallback || undefined,
        maxResults: num(args.maxResults, 20),
      }),
  },
  {
    name: 'calendar_create_event',
    description:
      'Create a calendar event. start/end are RFC3339 date-times, or YYYY-MM-DD for all-day.',
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
      },
      required: ['summary', 'start', 'end'],
    },
    run: async (token, args) => {
      const summary = str(args.summary);
      const start = str(args.start);
      const end = str(args.end);
      if (!summary || !start || !end) throw new Error('summary, start, and end are required');
      return calendarCreateEvent(token, {
        calendarId: str(args.calendarId) || undefined,
        summary,
        description: str(args.description) || undefined,
        location: str(args.location) || undefined,
        start,
        end,
        timeZone: str(args.timeZone) || undefined,
      });
    },
  },
  {
    name: 'calendar_update_event',
    description: 'Update an existing calendar event by eventId.',
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
      },
      required: ['eventId'],
    },
    run: async (token, args) => {
      const eventId = str(args.eventId);
      if (!eventId) throw new Error('eventId is required');
      return calendarUpdateEvent(token, {
        calendarId: str(args.calendarId) || undefined,
        eventId,
        summary: str(args.summary) || undefined,
        description: str(args.description) || undefined,
        location: str(args.location) || undefined,
        start: str(args.start) || undefined,
        end: str(args.end) || undefined,
        timeZone: str(args.timeZone) || undefined,
      });
    },
  },
  {
    name: 'calendar_delete_event',
    description: 'Delete a calendar event by eventId.',
    write: true,
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
      return calendarDeleteEvent(token, {
        calendarId: str(args.calendarId) || undefined,
        eventId,
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
      'Query free/busy for calendars between timeMin and timeMax (RFC3339). Defaults to primary calendar.',
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
