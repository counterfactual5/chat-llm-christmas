import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';
import {
  calendarCreateEvent,
  calendarDeleteEvent,
  calendarListCalendars,
  calendarListEvents,
  calendarUpdateEvent,
  driveCreateTextFile,
  driveGetFile,
  driveReadFileText,
  driveSearchFiles,
  gmailCreateDraft,
  gmailGetMessage,
  gmailListLabels,
  gmailSearchMessages,
  gmailSendMessage,
} from '@/lib/integrations/google-rest';

const GOOGLE_SYSTEM_PROMPT = [
  "You have Google Workspace tools (Gmail, Calendar, Drive) for the user's connected account via Google APIs.",
  'Gmail: search/read messages, create drafts, and send email when the user clearly asks.',
  'Calendar: list calendars/events; create, update, or delete events.',
  'Drive: search files, read text content, and create plain-text files.',
  'For write actions (send email, create/update/delete event, create file), confirm intent from the user message before calling.',
  'Do not invent message IDs, event IDs, or file IDs — only use tool results.',
  'Cite Gmail/Drive/Calendar links from tool results when answering.',
].join(' ');

function googleToken(ctx: ToolRuntimeContext): string | null {
  const token = ctx.credentials?.googleAccessToken?.trim();
  return token || null;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function queryHint(name: string, args: Record<string, unknown>): string {
  for (const key of [
    'query',
    'q',
    'subject',
    'to',
    'summary',
    'name',
    'messageId',
    'eventId',
    'fileId',
  ]) {
    const v = args[key];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 120);
  }
  return name.replace(/_/g, ' ');
}

function extractUiResults(
  name: string,
  payload: unknown,
): Array<{ title: string; url: string; snippet: string }> {
  try {
    const data = (payload && typeof payload === 'object' ? payload : {}) as Record<
      string,
      unknown
    >;
    const rows =
      (Array.isArray(data.messages) && data.messages) ||
      (Array.isArray(data.items) && data.items) ||
      (Array.isArray(data.files) && data.files) ||
      (Array.isArray(data.events) && data.events) ||
      null;
    if (rows) {
      return rows.slice(0, 8).map((item) => {
        const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        const url = String(row.htmlLink || row.webViewLink || row.url || '');
        return {
          title: String(
            row.subject || row.summary || row.name || row.title || url || 'Result',
          ).slice(0, 120),
          url,
          snippet: String(
            row.snippet || row.description || row.from || row.mimeType || '',
          ).slice(0, 240),
        };
      });
    }
    if (data.htmlLink || data.webViewLink || data.id) {
      return [
        {
          title: String(data.subject || data.summary || data.name || name).slice(0, 120),
          url: String(data.htmlLink || data.webViewLink || ''),
          snippet: String(data.snippet || data.description || data.bodyText || '').slice(0, 240),
        },
      ];
    }
  } catch {
    // ignore
  }
  return [];
}

type GoogleToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  write?: boolean;
  run: (token: string, args: Record<string, unknown>, fallback: string) => Promise<unknown>;
};

const TOOL_DEFS: GoogleToolDef[] = [
  {
    name: 'gmail_search',
    description:
      'Search the user Gmail inbox. Use Gmail search syntax in query (e.g. newer_than:7d, from:, subject:).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query' },
        maxResults: { type: 'integer', description: '1-50, default 10' },
        pageToken: { type: 'string' },
      },
    },
    run: async (token, args, fallback) =>
      gmailSearchMessages(token, {
        query: str(args.query) || fallback || undefined,
        maxResults: num(args.maxResults, 10),
        pageToken: str(args.pageToken) || undefined,
      }),
  },
  {
    name: 'gmail_get_message',
    description: 'Read a Gmail message by id (full text body when available).',
    parameters: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'Gmail message id' },
      },
      required: ['messageId'],
    },
    run: async (token, args) => {
      const messageId = str(args.messageId);
      if (!messageId) throw new Error('messageId is required');
      return gmailGetMessage(token, messageId);
    },
  },
  {
    name: 'gmail_list_labels',
    description: 'List Gmail labels for the connected account.',
    parameters: { type: 'object', properties: {} },
    run: async (token) => gmailListLabels(token),
  },
  {
    name: 'gmail_create_draft',
    description: 'Create a Gmail draft (does not send).',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Plain-text body' },
        cc: { type: 'string' },
        bcc: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
    },
    run: async (token, args) => {
      const to = str(args.to);
      const subject = str(args.subject);
      const body = str(args.body);
      if (!to || !subject || !body) throw new Error('to, subject, and body are required');
      return gmailCreateDraft(token, {
        to,
        subject,
        body,
        cc: str(args.cc) || undefined,
        bcc: str(args.bcc) || undefined,
      });
    },
  },
  {
    name: 'gmail_send',
    description: 'Send an email from the connected Gmail account. Only when the user clearly asked to send.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Plain-text body' },
        cc: { type: 'string' },
        bcc: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
    },
    run: async (token, args) => {
      const to = str(args.to);
      const subject = str(args.subject);
      const body = str(args.body);
      if (!to || !subject || !body) throw new Error('to, subject, and body are required');
      return gmailSendMessage(token, {
        to,
        subject,
        body,
        cc: str(args.cc) || undefined,
        bcc: str(args.bcc) || undefined,
      });
    },
  },
  {
    name: 'calendar_list_calendars',
    description: 'List calendars available to the connected Google account.',
    parameters: { type: 'object', properties: {} },
    run: async (token) => calendarListCalendars(token),
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
    name: 'drive_search',
    description:
      'Search Google Drive files. query uses Drive search syntax (e.g. name contains "report", mimeType=...).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        pageSize: { type: 'integer' },
        pageToken: { type: 'string' },
      },
    },
    run: async (token, args, fallback) => {
      let query = str(args.query);
      if (!query && fallback) query = `fullText contains '${fallback.replace(/'/g, "\\'")}'`;
      return driveSearchFiles(token, {
        query: query || undefined,
        pageSize: num(args.pageSize, 10),
        pageToken: str(args.pageToken) || undefined,
      });
    },
  },
  {
    name: 'drive_get_file',
    description: 'Get Google Drive file metadata by fileId.',
    parameters: {
      type: 'object',
      properties: { fileId: { type: 'string' } },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      return driveGetFile(token, fileId);
    },
  },
  {
    name: 'drive_read_file',
    description:
      'Read text content from a Drive file (exports Docs/Sheets when possible; otherwise downloads text).',
    parameters: {
      type: 'object',
      properties: { fileId: { type: 'string' } },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      return driveReadFileText(token, fileId);
    },
  },
  {
    name: 'drive_create_text_file',
    description: 'Create a plain-text file in Google Drive.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        content: { type: 'string' },
        parentId: { type: 'string', description: 'Optional folder id' },
      },
      required: ['name', 'content'],
    },
    run: async (token, args) => {
      const name = str(args.name);
      const content = str(args.content);
      if (!name || !content) throw new Error('name and content are required');
      return driveCreateTextFile(token, {
        name,
        content,
        parentId: str(args.parentId) || undefined,
      });
    },
  },
];

function makeTool(def: GoogleToolDef): ChatTool {
  return {
    name: def.name,
    definition: {
      type: 'function',
      function: {
        name: def.name,
        description: def.description.slice(0, 1024),
        parameters: def.parameters,
      },
    },
    systemPrompt: GOOGLE_SYSTEM_PROMPT,
    enabled: (flags) => flags.integrations.includes('google'),
    async execute({ rawArguments, fallbackQuery }, ctx) {
      const token = googleToken(ctx);
      if (!token) {
        return {
          content: JSON.stringify({
            ok: false,
            error: 'Google Workspace is not connected for this account.',
          }),
        };
      }

      const args = parseArgs(rawArguments);
      const fallback = String(fallbackQuery || ctx.userAsk || '').trim().slice(0, 200);
      const query = queryHint(def.name, args);
      const write = Boolean(def.write);

      ctx.send({
        tool: {
          status: 'start',
          name: def.name,
          query,
          provider: 'google',
          write,
        },
      });

      try {
        const result = await def.run(token, args, fallback);
        const results = extractUiResults(def.name, result);
        ctx.send({
          tool: {
            status: 'done',
            name: def.name,
            query,
            provider: 'google',
            write,
            results,
          },
        });
        return { content: JSON.stringify(result) };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : String(err || 'Google API call failed');
        ctx.send({
          tool: {
            status: 'done',
            name: def.name,
            query,
            provider: 'google',
            write,
            results: [],
            error: message,
          },
        });
        return { content: JSON.stringify({ ok: false, error: message }) };
      }
    },
  };
}

/** Register curated Gmail / Calendar / Drive REST tools for the chat model. */
export async function createGoogleTools(_accessToken: string): Promise<ChatTool[]> {
  // Token is validated per-call via runtime credentials; presence here means Google is authorized.
  return TOOL_DEFS.map(makeTool);
}

/** @deprecated Prefer createGoogleTools — kept for existing imports. */
export const createGoogleMcpTools = createGoogleTools;
