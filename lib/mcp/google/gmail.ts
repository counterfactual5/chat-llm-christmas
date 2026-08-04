import {
  gmailApplyLabelByQuery,
  gmailBatchGetMessages,
  gmailBatchModifyByQuery,
  gmailBatchModifyMessages,
  gmailBatchStarByQuery,
  gmailBatchTrashByQuery,
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
  gmailModifyThread,
  gmailReplyMessage,
  gmailSearchMessages,
  gmailSendDraft,
  gmailSendMessage,
  gmailThreadMarkRead,
  gmailTrashMessage,
  gmailUntrashMessage,
  gmailUpdateLabel,
} from '@/lib/integrations/google/gmail';
import { num, str, type GoogleToolDef } from '@/lib/mcp/google/shared';

export const gmailToolDefs: GoogleToolDef[] = [
  {
    name: 'gmail_get_profile',
    description: 'Get the connected Gmail profile (emailAddress, messagesTotal, threadsTotal, historyId).',
    parameters: { type: 'object', properties: {} },
    run: async (token) => gmailGetProfile(token),
  },
  {
    name: 'gmail_search',
    description:
      'Search the user Gmail inbox. Use Gmail search syntax in query (e.g. is:unread, newer_than:7d, from:, subject:). Returns messages (with id) plus a top-level ids[] for batch tools. For mark-all-read / archive-by-query prefer gmail_batch_mark_read or gmail_batch_modify_by_query instead of paging manually.',
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
    description:
      'Propose sending an email (opens an in-chat approval compose card). The email is NOT sent until the user presses Send. Only call when the user clearly asked to send.',
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
      'Propose a reply in the same Gmail thread (opens approval card; not sent until the user confirms). Uses original Message-ID headers. Set replyAll=true to CC other recipients.',
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
      'Propose forwarding a Gmail message (opens approval card; not sent until the user confirms). Quotes original plain-text body.',
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
      'Batch add/remove labels on many known message ids (up to 1000). Prefer gmail_batch_modify_by_query or gmail_batch_mark_read when you only have a search query. removeLabelIds=["UNREAD"] marks read; removeLabelIds=["INBOX"] archives.',
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
    name: 'gmail_batch_modify_by_query',
    description:
      'ONE-SHOT bulk label change: search with a Gmail query (paginated), then batch-modify all matching messages. Use for “mark all unread as read”, “archive everything from X”, etc. Do not manually page gmail_search first. When addLabelIds includes TRASH, confirm=true is required (same latch as gmail_batch_trash).',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Gmail search query, e.g. is:unread, from:alerts@example.com newer_than:30d',
        },
        addLabelIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Label ids to add',
        },
        removeLabelIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Label ids to remove (e.g. ["UNREAD"], ["INBOX"])',
        },
        maxTotal: {
          type: 'integer',
          description: 'Max messages to modify (1-2000, default 500)',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true when addLabelIds includes TRASH',
        },
      },
      required: ['query'],
    },
    run: async (token, args) => {
      const query = str(args.query);
      if (!query) throw new Error('query is required');
      const addLabelIds = Array.isArray(args.addLabelIds)
        ? args.addLabelIds.map((x) => str(x)).filter(Boolean)
        : [];
      const removeLabelIds = Array.isArray(args.removeLabelIds)
        ? args.removeLabelIds.map((x) => str(x)).filter(Boolean)
        : [];
      if (!addLabelIds.length && !removeLabelIds.length) {
        throw new Error('addLabelIds or removeLabelIds is required');
      }
      const addsTrash = addLabelIds.some((id) => id.toUpperCase() === 'TRASH');
      if (addsTrash && args.confirm !== true) {
        throw new Error('confirm=true is required when addLabelIds includes TRASH');
      }
      const maxTotal =
        typeof args.maxTotal === 'number' && Number.isFinite(args.maxTotal)
          ? args.maxTotal
          : num(args.maxTotal, 500);
      return gmailBatchModifyByQuery(token, {
        query,
        addLabelIds,
        removeLabelIds,
        maxTotal,
      });
    },
  },
  {
    name: 'gmail_batch_mark_read',
    description:
      'Mark matching messages as read (remove UNREAD). Requires an explicit Gmail query (e.g. is:unread newer_than:7d). Prefer this over looping gmail_search + gmail_batch_modify.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Required Gmail query. Example: is:unread newer_than:7d',
        },
        maxTotal: {
          type: 'integer',
          description: 'Max messages (1-2000, default 500)',
        },
      },
      required: ['query'],
    },
    run: async (token, args) => {
      const query = str(args.query);
      if (!query) throw new Error('query is required (refusing unbounded mark-read)');
      const maxTotal =
        typeof args.maxTotal === 'number' && Number.isFinite(args.maxTotal)
          ? args.maxTotal
          : num(args.maxTotal, 500);
      return gmailBatchModifyByQuery(token, {
        query,
        removeLabelIds: ['UNREAD'],
        maxTotal,
      });
    },
  },
  {
    name: 'gmail_batch_archive',
    description:
      'Archive matching messages (remove INBOX). Requires an explicit Gmail query (e.g. in:inbox older_than:1y). Prefer this for bulk archive.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Required Gmail query. Example: in:inbox older_than:1y',
        },
        maxTotal: {
          type: 'integer',
          description: 'Max messages (1-2000, default 500)',
        },
      },
      required: ['query'],
    },
    run: async (token, args) => {
      const query = str(args.query);
      if (!query) throw new Error('query is required (refusing unbounded archive)');
      const maxTotal =
        typeof args.maxTotal === 'number' && Number.isFinite(args.maxTotal)
          ? args.maxTotal
          : num(args.maxTotal, 500);
      return gmailBatchModifyByQuery(token, {
        query,
        removeLabelIds: ['INBOX'],
        maxTotal,
      });
    },
  },
  {
    name: 'gmail_batch_trash',
    description:
      'Move matching messages to Trash (add TRASH, remove INBOX). Requires an explicit query and confirm=true — never trash without both. Example: category:promotions older_than:1y',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Required Gmail query scoping what to trash',
        },
        maxTotal: {
          type: 'integer',
          description: 'Max messages (1-2000, default 200)',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to proceed (safety latch)',
        },
      },
      required: ['query', 'confirm'],
    },
    run: async (token, args) => {
      if (args.confirm !== true) {
        throw new Error('confirm=true is required for gmail_batch_trash');
      }
      const query = str(args.query);
      if (!query) throw new Error('query is required (refusing unbounded trash)');
      const maxTotal =
        typeof args.maxTotal === 'number' && Number.isFinite(args.maxTotal)
          ? args.maxTotal
          : num(args.maxTotal, 200);
      return gmailBatchTrashByQuery(token, { query, maxTotal });
    },
  },
  {
    name: 'gmail_batch_star',
    description:
      'Star matching messages (add STARRED). Requires an explicit query, e.g. from:boss@example.com newer_than:7d.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Gmail query (required)',
        },
        maxTotal: {
          type: 'integer',
          description: 'Max messages (1-2000, default 200)',
        },
      },
      required: ['query'],
    },
    run: async (token, args) => {
      const query = str(args.query);
      if (!query) throw new Error('query is required');
      const maxTotal =
        typeof args.maxTotal === 'number' && Number.isFinite(args.maxTotal)
          ? args.maxTotal
          : num(args.maxTotal, 200);
      return gmailBatchStarByQuery(token, { query, starred: true, maxTotal });
    },
  },
  {
    name: 'gmail_batch_unstar',
    description: 'Remove stars from matching messages (remove STARRED). Requires query, e.g. is:starred older_than:1y.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail query (required)' },
        maxTotal: {
          type: 'integer',
          description: 'Max messages (1-2000, default 200)',
        },
      },
      required: ['query'],
    },
    run: async (token, args) => {
      const query = str(args.query);
      if (!query) throw new Error('query is required');
      const maxTotal =
        typeof args.maxTotal === 'number' && Number.isFinite(args.maxTotal)
          ? args.maxTotal
          : num(args.maxTotal, 200);
      return gmailBatchStarByQuery(token, { query, starred: false, maxTotal });
    },
  },
  {
    name: 'gmail_apply_label_by_query',
    description:
      'Add or remove a label on all messages matching a query. Accepts label display name (e.g. "Receipts") or label id — resolves via list_labels. Prefer this over list_labels + batch_modify_by_query.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query' },
        label: {
          type: 'string',
          description: 'Label name or id (e.g. Receipts, Label_12)',
        },
        action: {
          type: 'string',
          description: 'add (default) | remove',
        },
        maxTotal: {
          type: 'integer',
          description: 'Max messages (1-2000, default 500)',
        },
      },
      required: ['query', 'label'],
    },
    run: async (token, args) => {
      const query = str(args.query);
      const label = str(args.label);
      if (!query || !label) throw new Error('query and label are required');
      const actionRaw = str(args.action).toLowerCase();
      const action = actionRaw === 'remove' ? 'remove' : 'add';
      const maxTotal =
        typeof args.maxTotal === 'number' && Number.isFinite(args.maxTotal)
          ? args.maxTotal
          : num(args.maxTotal, 500);
      return gmailApplyLabelByQuery(token, { query, label, action, maxTotal });
    },
  },
  {
    name: 'gmail_thread_mark_read',
    description:
      'Mark an entire conversation thread as read (remove UNREAD from all messages in the thread). Pass threadId from gmail_list_threads / gmail_get_thread / message.threadId.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Gmail thread id' },
      },
      required: ['threadId'],
    },
    run: async (token, args) => {
      const threadId = str(args.threadId);
      if (!threadId) throw new Error('threadId is required');
      return gmailThreadMarkRead(token, threadId);
    },
  },
  {
    name: 'gmail_modify_thread',
    description:
      'Add/remove labels on every message in a thread (Gmail threads.modify). Example: archive a thread with removeLabelIds=["INBOX"].',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
        addLabelIds: { type: 'array', items: { type: 'string' } },
        removeLabelIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['threadId'],
    },
    run: async (token, args) => {
      const threadId = str(args.threadId);
      if (!threadId) throw new Error('threadId is required');
      const addLabelIds = Array.isArray(args.addLabelIds)
        ? args.addLabelIds.map((x) => str(x)).filter(Boolean)
        : [];
      const removeLabelIds = Array.isArray(args.removeLabelIds)
        ? args.removeLabelIds.map((x) => str(x)).filter(Boolean)
        : [];
      if (!addLabelIds.length && !removeLabelIds.length) {
        throw new Error('addLabelIds or removeLabelIds is required');
      }
      return gmailModifyThread(token, { threadId, addLabelIds, removeLabelIds });
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
    description:
      'Propose sending an existing Gmail draft by draftId (opens approval card; not sent until the user confirms).',
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
];
