/**
 * `/papers download <id|url>` turn builder + markdown result.
 */

import type { Message, MessageToolRun } from '@/lib/chat/types';
import { titleForNewConversation } from '@/lib/chat/turn/attachments';
import {
  formatPaperDownloadCommand,
  inferPaperDownloadProvider,
} from '@/lib/chat/turn/literature-command';
import { mimeForDownloadedBook } from '@/lib/chat/turn/book-download-turn';

export type PaperDownloadThread = {
  thread: Message[];
  assistantId: string;
  toolRunId: string;
  newTitle?: string;
};

export function buildPaperDownloadThread(opts: {
  identifier: string;
  cleanedBase: Message[];
  skipDuplicateUser?: boolean;
  currentTitle?: string;
  now?: () => number;
  genId?: () => string;
}): PaperDownloadThread {
  const now = opts.now ?? Date.now;
  const genId = opts.genId ?? (() => crypto.randomUUID());
  const assistantId = genId();
  const toolRunId = genId();
  const userContent = formatPaperDownloadCommand(opts.identifier);
  const assistantMessage: Message = {
    id: assistantId,
    role: 'assistant',
    content: '',
    timestamp: now(),
    incomplete: true,
    toolRuns: [
      {
        id: toolRunId,
        name: 'paper_download',
        status: 'start',
        query: opts.identifier,
      },
    ],
    activity: [{ id: genId(), kind: 'tool', toolRunId }],
  };

  let newTitle = opts.currentTitle;
  if (
    opts.cleanedBase.length === 0 ||
    (opts.cleanedBase.length === 1 && opts.skipDuplicateUser)
  ) {
    newTitle = titleForNewConversation(userContent);
  }

  const thread = opts.skipDuplicateUser
    ? [...opts.cleanedBase, assistantMessage]
    : [
        ...opts.cleanedBase,
        {
          id: genId(),
          role: 'user' as const,
          content: userContent,
          timestamp: now(),
        },
        assistantMessage,
      ];

  return { thread, assistantId, toolRunId, newTitle };
}

/** Papers download always stores a PDF; fall back via book MIME map for safety. */
export function mimeForDownloadedPaper(filename: string): string {
  const name = String(filename || '').toLowerCase();
  if (name.endsWith('.pdf') || !name.includes('.')) return 'application/pdf';
  return mimeForDownloadedBook(filename);
}

/** No prose dump — the in-chat file card is the deliverable. */
export function formatPaperDownloadMarkdown(_result: {
  title: string;
  filename: string;
  bytes: number;
  sourceUrl: string;
  fileId: string;
  provider?: string;
}): string {
  return '';
}

export function paperDownloadToolRun(opts: {
  identifier: string;
  title: string;
  filename: string;
  sourceUrl: string;
  fileId?: string;
  provider?: string;
}): MessageToolRun {
  const provider =
    String(opts.provider || '').trim() || inferPaperDownloadProvider(opts.identifier);
  const fileUrl = opts.fileId
    ? `/api/files/${encodeURIComponent(opts.fileId)}`
    : '';
  return {
    id: crypto.randomUUID(),
    name: 'paper_download',
    status: 'done',
    query: opts.identifier,
    provider,
    results: [
      {
        title: opts.title,
        url: fileUrl || opts.sourceUrl || '',
        snippet: opts.filename,
        ...(opts.fileId
          ? { body: `file_id: ${opts.fileId}\nfilename: ${opts.filename}` }
          : {}),
      },
    ],
  };
}
