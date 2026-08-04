/**
 * `/books download <archiveId>` turn builder + markdown result.
 */

import type { Message, MessageToolRun } from '@/lib/chat/types';
import { titleForNewConversation } from '@/lib/chat/turn/attachments';
import {
  formatBookDownloadCommand,
  inferBookDownloadProvider,
} from '@/lib/chat/turn/literature-command';

export type BookDownloadThread = {
  thread: Message[];
  assistantId: string;
  toolRunId: string;
  newTitle?: string;
};

export function buildBookDownloadThread(opts: {
  identifier: string;
  cleanedBase: Message[];
  skipDuplicateUser?: boolean;
  currentTitle?: string;
  now?: () => number;
  genId?: () => string;
}): BookDownloadThread {
  const now = opts.now ?? Date.now;
  const genId = opts.genId ?? (() => crypto.randomUUID());
  const assistantId = genId();
  const toolRunId = genId();
  const userContent = formatBookDownloadCommand(opts.identifier);
  const assistantMessage: Message = {
    id: assistantId,
    role: 'assistant',
    content: '',
    timestamp: now(),
    incomplete: true,
    toolRuns: [
      {
        id: toolRunId,
        name: 'book_download',
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

/** Guess MIME for downloaded books (create_file's map is text-oriented). */
export function mimeForDownloadedBook(filename: string): string {
  const name = String(filename || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.epub')) return 'application/epub+zip';
  if (name.endsWith('.mobi')) return 'application/x-mobipocket-ebook';
  if (name.endsWith('.azw3') || name.endsWith('.azw')) return 'application/vnd.amazon.ebook';
  if (name.endsWith('.djvu')) return 'image/vnd.djvu';
  if (name.endsWith('.txt')) return 'text/plain';
  if (name.endsWith('.fb2')) return 'application/xml';
  return 'application/octet-stream';
}

/** No prose dump — the in-chat file card is the deliverable. */
export function formatBookDownloadMarkdown(_result: {
  title: string;
  filename: string;
  bytes: number;
  sourceUrl: string;
  fileId: string;
  provider?: string;
}): string {
  return '';
}

export function bookDownloadToolRun(opts: {
  identifier: string;
  title: string;
  filename: string;
  sourceUrl: string;
  fileId?: string;
  provider?: string;
}): MessageToolRun {
  const provider =
    String(opts.provider || '').trim() || inferBookDownloadProvider(opts.identifier);
  const fileUrl = opts.fileId
    ? `/api/files/${encodeURIComponent(opts.fileId)}`
    : '';
  return {
    id: crypto.randomUUID(),
    name: 'book_download',
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
