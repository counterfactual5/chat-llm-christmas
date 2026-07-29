import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';
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
  driveCopyFile,
  driveCreateComment,
  driveCreateFolder,
  driveCreateShortcut,
  driveCreateTextFile,
  driveDeleteComment,
  driveDeleteFile,
  driveExportFile,
  driveGetFile,
  driveListChildren,
  driveListComments,
  driveListPermissions,
  driveListSharedDrives,
  driveReadFileText,
  driveRevokePermission,
  driveSearchFiles,
  driveShareFile,
  driveTrashFile,
  driveUntrashFile,
  driveUpdateFile,
  driveUploadFile,
  gmailBatchGetMessages,
  gmailBatchModifyMessages,
  gmailCreateDraft,
  gmailCreateLabel,
  gmailDeleteDraft,
  gmailDeleteLabel,
  gmailForwardMessage,
  gmailGetAttachment,
  gmailGetMessage,
  gmailGetProfile,
  gmailGetThread,
  gmailListDrafts,
  gmailListLabels,
  gmailListThreads,
  gmailModifyMessage,
  gmailReplyMessage,
  gmailSearchMessages,
  gmailSendDraft,
  gmailSendMessage,
  gmailTrashMessage,
  gmailUntrashMessage,
  gmailUpdateLabel,
} from '@/lib/integrations/google-rest';

const GMAIL_SYSTEM_PROMPT = [
  'You have Gmail MCP tools for the user\'s connected Google account.',
  'Profile; search/read messages (incl. batch get) & threads; attachments; labels CRUD; drafts; send/reply/forward; modify/batch-modify; trash/untrash.',
  'For send/reply/forward/trash/label changes, confirm intent from the user message before calling.',
  'Do not invent message IDs — only use tool results. Cite Gmail links when answering.',
].join(' ');

const CALENDAR_SYSTEM_PROMPT = [
  'You have Google Calendar MCP tools for the user\'s connected Google account.',
  'List/create calendars; list/get/create/update/delete/move events; recurring instances; free/busy; list/add/remove calendar ACL sharing.',
  'For create/update/delete/move/ACL, confirm intent from the user message before calling.',
  'Do not invent event IDs — only use tool results. Cite Calendar links when answering.',
].join(' ');

const DRIVE_SYSTEM_PROMPT = [
  'You have Google Drive MCP tools for the user\'s connected Google account.',
  'Search/get/read/export/upload; list folder children; create text/folder/shortcut; shared drives; copy; rename/move; trash/delete; permissions; comments.',
  'For share/trash/delete/create/upload/comments, confirm intent from the user message before calling.',
  'Do not invent file IDs — only use tool results. Cite Drive links when answering.',
].join(' ');

function serviceSystemPrompt(service: 'gmail' | 'calendar' | 'drive'): string {
  if (service === 'calendar') return CALENDAR_SYSTEM_PROMPT;
  if (service === 'drive') return DRIVE_SYSTEM_PROMPT;
  return GMAIL_SYSTEM_PROMPT;
}

function toolService(name: string): 'gmail' | 'calendar' | 'drive' {
  if (name.startsWith('calendar_')) return 'calendar';
  if (name.startsWith('drive_')) return 'drive';
  return 'gmail';
}

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
    'threadId',
    'draftId',
    'attachmentId',
    'labelId',
    'targetId',
    'eventId',
    'fileId',
    'permissionId',
    'parentId',
    'commentId',
    'ruleId',
    'destinationCalendarId',
  ]) {
    const v = args[key];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 120);
  }
  if (Array.isArray(args.messageIds) && args.messageIds.length) {
    return `${args.messageIds.length} messages`;
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
      (Array.isArray(data.threads) && data.threads) ||
      (Array.isArray(data.drafts) && data.drafts) ||
      (Array.isArray(data.drives) && data.drives) ||
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
    name: 'gmail_get_profile',
    description: 'Get the connected Gmail profile (emailAddress, messagesTotal, threadsTotal, historyId).',
    parameters: { type: 'object', properties: {} },
    run: async (token) => gmailGetProfile(token),
  },
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
    description:
      'Read a Gmail message by id (full text body + attachment metadata when available).',
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
    name: 'gmail_batch_get',
    description:
      'Fetch multiple Gmail messages by id (up to 20). Prefer this over many gmail_get_message calls.',
    parameters: {
      type: 'object',
      properties: {
        messageIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Gmail message ids (max 20)',
        },
      },
      required: ['messageIds'],
    },
    run: async (token, args) => {
      const messageIds = Array.isArray(args.messageIds)
        ? args.messageIds.map((x) => str(x)).filter(Boolean)
        : [];
      if (!messageIds.length) throw new Error('messageIds is required');
      return gmailBatchGetMessages(token, messageIds);
    },
  },
  {
    name: 'gmail_list_labels',
    description: 'List Gmail labels for the connected account.',
    parameters: { type: 'object', properties: {} },
    run: async (token) => gmailListLabels(token),
  },
  {
    name: 'gmail_create_label',
    description: 'Create a custom Gmail label.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        messageListVisibility: { type: 'string', description: 'show | hide' },
        labelListVisibility: {
          type: 'string',
          description: 'labelShow | labelShowIfUnread | labelHide',
        },
      },
      required: ['name'],
    },
    run: async (token, args) => {
      const name = str(args.name);
      if (!name) throw new Error('name is required');
      return gmailCreateLabel(token, {
        name,
        messageListVisibility: str(args.messageListVisibility) || undefined,
        labelListVisibility: str(args.labelListVisibility) || undefined,
      });
    },
  },
  {
    name: 'gmail_update_label',
    description: 'Rename or change visibility of a custom Gmail label.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        labelId: { type: 'string' },
        name: { type: 'string' },
        messageListVisibility: { type: 'string' },
        labelListVisibility: { type: 'string' },
      },
      required: ['labelId'],
    },
    run: async (token, args) => {
      const labelId = str(args.labelId);
      if (!labelId) throw new Error('labelId is required');
      return gmailUpdateLabel(token, {
        labelId,
        name: str(args.name) || undefined,
        messageListVisibility: str(args.messageListVisibility) || undefined,
        labelListVisibility: str(args.labelListVisibility) || undefined,
      });
    },
  },
  {
    name: 'gmail_delete_label',
    description: 'Delete a custom Gmail label by labelId.',
    write: true,
    parameters: {
      type: 'object',
      properties: { labelId: { type: 'string' } },
      required: ['labelId'],
    },
    run: async (token, args) => {
      const labelId = str(args.labelId);
      if (!labelId) throw new Error('labelId is required');
      return gmailDeleteLabel(token, labelId);
    },
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
    name: 'gmail_reply',
    description:
      'Reply to a Gmail message in the same thread. Uses original Message-ID headers. Set replyAll=true to CC other recipients.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'Original Gmail message id to reply to' },
        body: { type: 'string', description: 'Plain-text reply body' },
        replyAll: { type: 'boolean' },
        to: { type: 'string', description: 'Override To (default: original From)' },
        cc: { type: 'string' },
        subject: { type: 'string', description: 'Override subject (default Re: …)' },
      },
      required: ['messageId', 'body'],
    },
    run: async (token, args) => {
      const messageId = str(args.messageId);
      const body = str(args.body);
      if (!messageId || !body) throw new Error('messageId and body are required');
      return gmailReplyMessage(token, {
        messageId,
        body,
        replyAll: Boolean(args.replyAll),
        to: str(args.to) || undefined,
        cc: str(args.cc) || undefined,
        subject: str(args.subject) || undefined,
      });
    },
  },
  {
    name: 'gmail_forward',
    description:
      'Forward a Gmail message to a new recipient (quotes original plain-text body).',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        messageId: { type: 'string' },
        to: { type: 'string' },
        body: { type: 'string', description: 'Optional note above the forwarded content' },
        cc: { type: 'string' },
        bcc: { type: 'string' },
      },
      required: ['messageId', 'to'],
    },
    run: async (token, args) => {
      const messageId = str(args.messageId);
      const to = str(args.to);
      if (!messageId || !to) throw new Error('messageId and to are required');
      return gmailForwardMessage(token, {
        messageId,
        to,
        body: str(args.body) || undefined,
        cc: str(args.cc) || undefined,
        bcc: str(args.bcc) || undefined,
      });
    },
  },
  {
    name: 'gmail_get_attachment',
    description:
      'Download a Gmail attachment by messageId + attachmentId (from gmail_get_message.attachments). Text attachments return utf-8 text; binary returns truncated base64url preview.',
    parameters: {
      type: 'object',
      properties: {
        messageId: { type: 'string' },
        attachmentId: { type: 'string' },
      },
      required: ['messageId', 'attachmentId'],
    },
    run: async (token, args) => {
      const messageId = str(args.messageId);
      const attachmentId = str(args.attachmentId);
      if (!messageId || !attachmentId) {
        throw new Error('messageId and attachmentId are required');
      }
      return gmailGetAttachment(token, { messageId, attachmentId });
    },
  },
  {
    name: 'gmail_modify_labels',
    description:
      'Add/remove Gmail labels on one message. Use system labels: UNREAD (mark unread=add / mark read=remove), STARRED, INBOX (archive=remove INBOX), IMPORTANT, SPAM, TRASH, or custom label ids from gmail_list_labels.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        messageId: { type: 'string' },
        addLabelIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Label ids to add',
        },
        removeLabelIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Label ids to remove (e.g. ["UNREAD"] to mark read)',
        },
      },
      required: ['messageId'],
    },
    run: async (token, args) => {
      const messageId = str(args.messageId);
      if (!messageId) throw new Error('messageId is required');
      const addLabelIds = Array.isArray(args.addLabelIds)
        ? args.addLabelIds.map((x) => str(x)).filter(Boolean)
        : [];
      const removeLabelIds = Array.isArray(args.removeLabelIds)
        ? args.removeLabelIds.map((x) => str(x)).filter(Boolean)
        : [];
      if (!addLabelIds.length && !removeLabelIds.length) {
        throw new Error('addLabelIds or removeLabelIds is required');
      }
      return gmailModifyMessage(token, { messageId, addLabelIds, removeLabelIds });
    },
  },
  {
    name: 'gmail_batch_modify',
    description:
      'Batch add/remove labels on many messages (e.g. mark all unread as read). Pass messageIds from gmail_search. removeLabelIds=["UNREAD"] marks read; removeLabelIds=["INBOX"] archives.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        messageIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Up to 1000 Gmail message ids',
        },
        addLabelIds: { type: 'array', items: { type: 'string' } },
        removeLabelIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['messageIds'],
    },
    run: async (token, args) => {
      const messageIds = Array.isArray(args.messageIds)
        ? args.messageIds.map((x) => str(x)).filter(Boolean)
        : [];
      if (!messageIds.length) throw new Error('messageIds is required');
      const addLabelIds = Array.isArray(args.addLabelIds)
        ? args.addLabelIds.map((x) => str(x)).filter(Boolean)
        : [];
      const removeLabelIds = Array.isArray(args.removeLabelIds)
        ? args.removeLabelIds.map((x) => str(x)).filter(Boolean)
        : [];
      if (!addLabelIds.length && !removeLabelIds.length) {
        throw new Error('addLabelIds or removeLabelIds is required');
      }
      return gmailBatchModifyMessages(token, { messageIds, addLabelIds, removeLabelIds });
    },
  },
  {
    name: 'gmail_trash',
    description: 'Move a Gmail message to Trash.',
    write: true,
    parameters: {
      type: 'object',
      properties: { messageId: { type: 'string' } },
      required: ['messageId'],
    },
    run: async (token, args) => {
      const messageId = str(args.messageId);
      if (!messageId) throw new Error('messageId is required');
      return gmailTrashMessage(token, messageId);
    },
  },
  {
    name: 'gmail_untrash',
    description: 'Restore a Gmail message from Trash.',
    write: true,
    parameters: {
      type: 'object',
      properties: { messageId: { type: 'string' } },
      required: ['messageId'],
    },
    run: async (token, args) => {
      const messageId = str(args.messageId);
      if (!messageId) throw new Error('messageId is required');
      return gmailUntrashMessage(token, messageId);
    },
  },
  {
    name: 'gmail_list_threads',
    description:
      'List Gmail conversation threads. Use Gmail search syntax in query (same as gmail_search).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        maxResults: { type: 'integer', description: '1-50, default 10' },
        pageToken: { type: 'string' },
      },
    },
    run: async (token, args, fallback) =>
      gmailListThreads(token, {
        query: str(args.query) || fallback || undefined,
        maxResults: num(args.maxResults, 10),
        pageToken: str(args.pageToken) || undefined,
      }),
  },
  {
    name: 'gmail_get_thread',
    description: 'Read a full Gmail thread (all messages) by threadId.',
    parameters: {
      type: 'object',
      properties: { threadId: { type: 'string' } },
      required: ['threadId'],
    },
    run: async (token, args) => {
      const threadId = str(args.threadId);
      if (!threadId) throw new Error('threadId is required');
      return gmailGetThread(token, threadId);
    },
  },
  {
    name: 'gmail_list_drafts',
    description: 'List Gmail drafts for the connected account.',
    parameters: {
      type: 'object',
      properties: {
        maxResults: { type: 'integer' },
        pageToken: { type: 'string' },
      },
    },
    run: async (token, args) =>
      gmailListDrafts(token, {
        maxResults: num(args.maxResults, 10),
        pageToken: str(args.pageToken) || undefined,
      }),
  },
  {
    name: 'gmail_delete_draft',
    description: 'Permanently delete a Gmail draft by draftId.',
    write: true,
    parameters: {
      type: 'object',
      properties: { draftId: { type: 'string' } },
      required: ['draftId'],
    },
    run: async (token, args) => {
      const draftId = str(args.draftId);
      if (!draftId) throw new Error('draftId is required');
      return gmailDeleteDraft(token, draftId);
    },
  },
  {
    name: 'gmail_send_draft',
    description: 'Send an existing Gmail draft by draftId.',
    write: true,
    parameters: {
      type: 'object',
      properties: { draftId: { type: 'string' } },
      required: ['draftId'],
    },
    run: async (token, args) => {
      const draftId = str(args.draftId);
      if (!draftId) throw new Error('draftId is required');
      return gmailSendDraft(token, draftId);
    },
  },
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
    name: 'drive_list_children',
    description:
      'List files/folders directly inside a Drive folder. Defaults to My Drive root.',
    parameters: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: 'Folder id; omit for root' },
        parentId: { type: 'string', description: 'Alias of folderId' },
        pageSize: { type: 'integer' },
        pageToken: { type: 'string' },
      },
    },
    run: async (token, args) =>
      driveListChildren(token, {
        folderId: str(args.folderId) || str(args.parentId) || undefined,
        pageSize: num(args.pageSize, 20),
        pageToken: str(args.pageToken) || undefined,
      }),
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
  {
    name: 'drive_create_folder',
    description: 'Create a folder in Google Drive.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        parentId: { type: 'string', description: 'Optional parent folder id' },
      },
      required: ['name'],
    },
    run: async (token, args) => {
      const name = str(args.name);
      if (!name) throw new Error('name is required');
      return driveCreateFolder(token, {
        name,
        parentId: str(args.parentId) || undefined,
      });
    },
  },
  {
    name: 'drive_copy_file',
    description: 'Copy a Drive file. Optionally rename and/or place in another folder.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        name: { type: 'string' },
        parentId: { type: 'string' },
      },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      return driveCopyFile(token, {
        fileId,
        name: str(args.name) || undefined,
        parentId: str(args.parentId) || undefined,
      });
    },
  },
  {
    name: 'drive_update_file',
    description:
      'Rename a Drive file and/or move it (addParents / removeParents). Use removeParents of the current parent and addParents of the destination to move.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        addParents: { type: 'array', items: { type: 'string' } },
        removeParents: { type: 'array', items: { type: 'string' } },
      },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      const addParents = Array.isArray(args.addParents)
        ? args.addParents.map((x) => str(x)).filter(Boolean)
        : undefined;
      const removeParents = Array.isArray(args.removeParents)
        ? args.removeParents.map((x) => str(x)).filter(Boolean)
        : undefined;
      const name = str(args.name) || undefined;
      const description =
        args.description === undefined ? undefined : str(args.description);
      if (!name && description === undefined && !addParents?.length && !removeParents?.length) {
        throw new Error('Provide name, description, addParents, and/or removeParents');
      }
      return driveUpdateFile(token, {
        fileId,
        name,
        description,
        addParents,
        removeParents,
      });
    },
  },
  {
    name: 'drive_trash',
    description: 'Move a Drive file to trash.',
    write: true,
    parameters: {
      type: 'object',
      properties: { fileId: { type: 'string' } },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      return driveTrashFile(token, fileId);
    },
  },
  {
    name: 'drive_untrash',
    description: 'Restore a Drive file from trash.',
    write: true,
    parameters: {
      type: 'object',
      properties: { fileId: { type: 'string' } },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      return driveUntrashFile(token, fileId);
    },
  },
  {
    name: 'drive_delete',
    description: 'Permanently delete a Drive file (skips trash). Prefer drive_trash unless the user asked to permanently delete.',
    write: true,
    parameters: {
      type: 'object',
      properties: { fileId: { type: 'string' } },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      return driveDeleteFile(token, fileId);
    },
  },
  {
    name: 'drive_export',
    description:
      'Export a Google Docs/Sheets/Slides file to another MIME (default: Docs→text/plain, Sheets→text/csv).',
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        mimeType: {
          type: 'string',
          description: 'Target MIME, e.g. text/plain, text/csv, application/pdf',
        },
      },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      return driveExportFile(token, {
        fileId,
        mimeType: str(args.mimeType) || undefined,
      });
    },
  },
  {
    name: 'drive_list_permissions',
    description: 'List sharing permissions for a Drive file.',
    parameters: {
      type: 'object',
      properties: { fileId: { type: 'string' } },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      return driveListPermissions(token, fileId);
    },
  },
  {
    name: 'drive_share',
    description:
      'Share a Drive file. type=user|group|domain|anyone; role=reader|commenter|writer. For user/group provide emailAddress.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        role: {
          type: 'string',
          description: 'reader | commenter | writer | owner',
        },
        type: {
          type: 'string',
          description: 'user | group | domain | anyone',
        },
        emailAddress: { type: 'string' },
        domain: { type: 'string' },
        sendNotificationEmail: { type: 'boolean', description: 'Default true' },
      },
      required: ['fileId', 'role', 'type'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      const role = str(args.role) as 'reader' | 'commenter' | 'writer' | 'owner';
      const type = str(args.type) as 'user' | 'group' | 'domain' | 'anyone';
      if (!fileId || !role || !type) throw new Error('fileId, role, and type are required');
      if (!['reader', 'commenter', 'writer', 'owner'].includes(role)) {
        throw new Error('role must be reader, commenter, writer, or owner');
      }
      if (!['user', 'group', 'domain', 'anyone'].includes(type)) {
        throw new Error('type must be user, group, domain, or anyone');
      }
      return driveShareFile(token, {
        fileId,
        role,
        type,
        emailAddress: str(args.emailAddress) || undefined,
        domain: str(args.domain) || undefined,
        sendNotificationEmail:
          args.sendNotificationEmail === undefined
            ? undefined
            : Boolean(args.sendNotificationEmail),
      });
    },
  },
  {
    name: 'drive_revoke_permission',
    description: 'Revoke a Drive sharing permission by permissionId (from drive_list_permissions).',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        permissionId: { type: 'string' },
      },
      required: ['fileId', 'permissionId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      const permissionId = str(args.permissionId);
      if (!fileId || !permissionId) throw new Error('fileId and permissionId are required');
      return driveRevokePermission(token, { fileId, permissionId });
    },
  },
  {
    name: 'drive_create_shortcut',
    description: 'Create a Drive shortcut pointing at targetId.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        targetId: { type: 'string', description: 'Target file/folder id' },
        name: { type: 'string' },
        parentId: { type: 'string' },
      },
      required: ['targetId'],
    },
    run: async (token, args) => {
      const targetId = str(args.targetId);
      if (!targetId) throw new Error('targetId is required');
      return driveCreateShortcut(token, {
        targetId,
        name: str(args.name) || undefined,
        parentId: str(args.parentId) || undefined,
      });
    },
  },
  {
    name: 'drive_list_shared_drives',
    description: 'List Shared drives (Team Drives) available to the connected account.',
    parameters: {
      type: 'object',
      properties: {
        pageSize: { type: 'integer' },
        pageToken: { type: 'string' },
      },
    },
    run: async (token, args) =>
      driveListSharedDrives(token, {
        pageSize: num(args.pageSize, 20),
        pageToken: str(args.pageToken) || undefined,
      }),
  },
  {
    name: 'drive_upload_file',
    description:
      'Upload a file to Drive. Prefer content for utf-8 text; use contentBase64 for binary (max ~1.5MB).',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        mimeType: { type: 'string' },
        parentId: { type: 'string' },
        content: { type: 'string', description: 'UTF-8 text body' },
        contentBase64: { type: 'string', description: 'Base64 / base64url binary body' },
      },
      required: ['name'],
    },
    run: async (token, args) => {
      const name = str(args.name);
      if (!name) throw new Error('name is required');
      const content = args.content === undefined ? undefined : String(args.content);
      const contentBase64 = str(args.contentBase64) || undefined;
      if (content === undefined && !contentBase64) {
        throw new Error('content or contentBase64 is required');
      }
      return driveUploadFile(token, {
        name,
        mimeType: str(args.mimeType) || undefined,
        parentId: str(args.parentId) || undefined,
        content,
        contentBase64,
      });
    },
  },
  {
    name: 'drive_list_comments',
    description: 'List comments on a Drive file.',
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        pageSize: { type: 'integer' },
        pageToken: { type: 'string' },
      },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      return driveListComments(token, {
        fileId,
        pageSize: num(args.pageSize, 20),
        pageToken: str(args.pageToken) || undefined,
      });
    },
  },
  {
    name: 'drive_create_comment',
    description: 'Add a comment to a Drive file.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['fileId', 'content'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      const content = str(args.content);
      if (!fileId || !content) throw new Error('fileId and content are required');
      return driveCreateComment(token, { fileId, content });
    },
  },
  {
    name: 'drive_delete_comment',
    description: 'Delete a Drive comment by commentId.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        commentId: { type: 'string' },
      },
      required: ['fileId', 'commentId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      const commentId = str(args.commentId);
      if (!fileId || !commentId) throw new Error('fileId and commentId are required');
      return driveDeleteComment(token, { fileId, commentId });
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
    systemPrompt: serviceSystemPrompt(toolService(def.name)),
    enabled: (flags) => flags.integrations.includes(toolService(def.name)),
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
export async function createGoogleTools(
  _accessToken: string,
  integrations: string[] = ['gmail', 'calendar', 'drive'],
): Promise<ChatTool[]> {
  // Token is validated per-call via runtime credentials; presence here means Google is authorized.
  const enabled = new Set(
    integrations
      .map((id) => String(id || '').trim().toLowerCase())
      .filter((id) => id === 'gmail' || id === 'calendar' || id === 'drive'),
  );
  // Legacy single toggle.
  if (integrations.map((id) => String(id || '').trim().toLowerCase()).includes('google')) {
    enabled.add('gmail');
    enabled.add('calendar');
    enabled.add('drive');
  }
  return TOOL_DEFS.filter((def) => enabled.has(toolService(def.name))).map(makeTool);
}

/** @deprecated Prefer createGoogleTools — kept for existing imports. */
export const createGoogleMcpTools = createGoogleTools;
