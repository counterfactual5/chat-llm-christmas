import type { ToolRuntimeContext } from '@/lib/tools/registry';

export type GoogleService = 'gmail' | 'calendar' | 'drive';

export const GMAIL_SYSTEM_PROMPT = [
  "You have Gmail MCP tools for the user's connected Google account.",
  'Profile; search/read messages (incl. batch get) & threads; attachments; labels CRUD; drafts; send/reply/forward; modify/batch-modify; trash/untrash.',
  'For send/reply/forward/trash/label changes, confirm intent from the user message before calling.',
  'Do not invent message IDs — only use tool results. Cite Gmail links when answering.',
].join(' ');

export const CALENDAR_SYSTEM_PROMPT = [
  "You have Google Calendar MCP tools for the user's connected Google account.",
  'List/create calendars; list/get/create/update/delete/move events; recurring instances; free/busy; list/add/remove calendar ACL sharing.',
  'For create/update/delete/move/ACL, confirm intent from the user message before calling.',
  'Do not invent event IDs — only use tool results. Cite Calendar links when answering.',
].join(' ');

export const DRIVE_SYSTEM_PROMPT = [
  "You have Google Drive MCP tools for the user's connected Google account.",
  'Search/get/read/export/upload; list folder children; create text/folder/shortcut; shared drives; copy; rename/move; trash/delete; permissions; comments.',
  'For share/trash/delete/create/upload/comments, confirm intent from the user message before calling.',
  'Do not invent file IDs — only use tool results. Cite Drive links when answering.',
].join(' ');

export function serviceSystemPrompt(service: GoogleService): string {
  if (service === 'calendar') return CALENDAR_SYSTEM_PROMPT;
  if (service === 'drive') return DRIVE_SYSTEM_PROMPT;
  return GMAIL_SYSTEM_PROMPT;
}

export function toolService(name: string): GoogleService {
  if (name.startsWith('calendar_')) return 'calendar';
  if (name.startsWith('drive_')) return 'drive';
  return 'gmail';
}

export function googleToken(ctx: ToolRuntimeContext): string | null {
  const token = ctx.credentials?.googleAccessToken?.trim();
  return token || null;
}

export function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

export function num(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function queryHint(name: string, args: Record<string, unknown>): string {
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
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 120);
  }
  if (Array.isArray(args.messageIds) && args.messageIds.length) {
    return `${args.messageIds.length} messages`;
  }
  return name.replace(/_/g, ' ');
}

export function extractUiResults(
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
          title: String(row.subject || row.summary || row.name || row.title || url || 'Result').slice(
            0,
            120,
          ),
          url,
          snippet: String(row.snippet || row.description || row.from || row.mimeType || '').slice(0, 240),
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
    // Ignore unstructured tool payloads.
  }
  return [];
}

export type GoogleToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  write?: boolean;
  run: (token: string, args: Record<string, unknown>, fallback: string) => Promise<unknown>;
};
