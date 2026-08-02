/**
 * `/books download <archiveId>` turn builder + markdown result.
 */

import type { Message, MessageToolRun } from '@/lib/chat/types';
import { titleForNewConversation } from '@/lib/chat/turn/attachments';
import { formatBookDownloadCommand } from '@/lib/chat/turn/literature-command';

export type BookDownloadThread = {
  thread: Message[];
  assistantId: string;
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
  const userContent = formatBookDownloadCommand(opts.identifier);
  const assistantMessage: Message = {
    id: assistantId,
    role: 'assistant',
    content: 'Downloading book…',
    timestamp: now(),
    incomplete: true,
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

  return { thread, assistantId, newTitle };
}

export function formatBookDownloadMarkdown(result: {
  title: string;
  filename: string;
  bytes: number;
  sourceUrl: string;
  fileId: string;
  provider?: string;
}): string {
  const source =
    result.sourceUrl ||
    (result.provider === 'libgen' ? 'Library Genesis' : 'Internet Archive');
  return [
    '### Book downloaded',
    '',
    `**${result.title}**`,
    `- File: \`${result.filename}\` (${result.bytes} bytes)`,
    `- Source: ${source}`,
    `- Saved as file \`${result.fileId}\` — open Files panel to download.`,
  ].join('\n');
}

export function bookDownloadToolRun(opts: {
  identifier: string;
  title: string;
  filename: string;
  sourceUrl: string;
  provider?: string;
}): MessageToolRun {
  const provider =
    opts.provider ||
    (/^libgen:/i.test(opts.identifier) || /^[a-f0-9]{32}$/i.test(opts.identifier)
      ? 'libgen'
      : 'internet-archive');
  const fallbackUrl =
    provider === 'libgen'
      ? `https://libgen.li/ads.php?md5=${opts.identifier.replace(/^libgen:/i, '')}`
      : `https://archive.org/details/${opts.identifier}`;
  return {
    id: crypto.randomUUID(),
    name: 'book_download',
    status: 'done',
    query: opts.identifier,
    provider,
    results: [
      {
        title: opts.title,
        url: opts.sourceUrl || fallbackUrl,
        snippet: opts.filename,
      },
    ],
  };
}
