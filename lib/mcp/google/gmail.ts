import {
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
];
