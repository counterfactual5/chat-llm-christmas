import type { ChatSession } from '@/lib/chat/types';
import { stripMessageStamp } from '@/lib/chat/context/time-context';

function touchSession(session: ChatSession, patch: Partial<ChatSession>): ChatSession {
  return { ...session, ...patch, updatedAt: Date.now() };
}

export type GeneratedFileInput = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  content?: string;
  createdAt?: number;
};

export function withAppendedAssistantGeneratedFile(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  file: GeneratedFileInput,
): ChatSession[] {
  const content = typeof file.content === 'string' ? file.content : undefined;
  const entry = {
    id: String(file.id || '').trim(),
    name: String(file.name || 'file').trim() || 'file',
    mimeType: String(file.mimeType || 'text/plain').trim() || 'text/plain',
    size: typeof file.size === 'number' ? file.size : 0,
    url:
      String(file.url || '').trim() ||
      (content != null ? `local://${String(file.id || '').trim()}` : ''),
    ...(content != null ? { content } : {}),
    createdAt: typeof file.createdAt === 'number' ? file.createdAt : Date.now(),
  };
  if (!entry.id || (!entry.url && content == null)) return sessions;
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    return touchSession(session, {
      messages: session.messages.map((message) => {
        if (message.id !== assistantId) return message;
        const existing = message.files || [];
        if (existing.some((item) => item.id === entry.id)) return message;
        const activity = [...(message.activity || [])];
        const alreadyInTimeline = activity.some(
          (step) => step.kind === 'file' && step.fileId === entry.id,
        );
        if (!alreadyInTimeline) {
          activity.push({
            id: `${assistantId}-file-${entry.id}`,
            kind: 'file',
            fileId: entry.id,
          });
        }
        return { ...message, files: [...existing, entry], activity };
      }),
    });
  });
}

export function withMarkedAssistantIncomplete(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  incomplete: boolean,
  meta?: { finishReason?: string | null; truncationReason?: string },
): ChatSession[] {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    return touchSession(session, {
      messages: session.messages.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              incomplete,
              finishReason: meta?.finishReason ?? message.finishReason,
              truncationReason: incomplete ? meta?.truncationReason : undefined,
              ...(!incomplete ? { reviewFixStreaming: false } : {}),
            }
          : message,
      ),
    });
  });
}

export function withAppendedAssistantContent(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  chunk: string,
): ChatSession[] {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    if (!session.messages.some((message) => message.id === assistantId)) return session;
    const messages = session.messages.map((message) => {
      if (message.id !== assistantId) return message;
      const activity = [...(message.activity || [])];
      const last = activity[activity.length - 1];
      if (last?.kind === 'content') {
        activity[activity.length - 1] = { ...last, text: last.text + chunk };
      } else {
        activity.push({ id: crypto.randomUUID(), kind: 'content', text: chunk });
      }
      return {
        ...message,
        content: stripMessageStamp(message.content + chunk),
        activity,
        incomplete: true,
      };
    });
    return touchSession(session, { messages });
  });
}

export function withAppendedAssistantReasoning(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  chunk: string,
): ChatSession[] {
  if (!chunk) return sessions;
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    if (!session.messages.some((message) => message.id === assistantId)) return session;
    const messages = session.messages.map((message) => {
      if (message.id !== assistantId) return message;
      const activity = [...(message.activity || [])];
      const last = activity[activity.length - 1];
      if (last?.kind === 'reasoning') {
        activity[activity.length - 1] = { ...last, text: last.text + chunk };
      } else {
        activity.push({ id: crypto.randomUUID(), kind: 'reasoning', text: chunk });
      }
      return {
        ...message,
        reasoning: (message.reasoning || '') + chunk,
        activity,
        incomplete: true,
      };
    });
    return touchSession(session, { messages });
  });
}

export function withSettledOpenToolRuns(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
): ChatSession[] {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const messages = session.messages.map((message) => {
      if (message.id !== assistantId || !message.toolRuns?.some((run) => run.status === 'start')) {
        return message;
      }
      return {
        ...message,
        toolRuns: message.toolRuns.map((run) =>
          run.status === 'start' ? { ...run, status: 'done' as const } : run,
        ),
      };
    });
    return { ...session, messages };
  });
}

export function withPromotedOrphanReasoning(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  orphan: string,
): ChatSession[] {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    return touchSession(session, {
      messages: session.messages.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              content: orphan,
              reasoning: undefined,
              activity: (message.activity || []).filter((item) => item.kind !== 'reasoning'),
            }
          : message,
      ),
    });
  });
}

export function withEmptyReplyFallback(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  fallback: string,
): ChatSession[] {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    return touchSession(session, {
      messages: session.messages.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              content: fallback,
              incomplete: false,
              truncationReason: undefined,
            }
          : message,
      ),
    });
  });
}

export function withSeededAssistantCleanup(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  seededContent: string,
  seededReasoning: string | undefined,
): ChatSession[] {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    return {
      ...session,
      messages: session.messages.map((message) => {
        if (message.id !== assistantId) return message;
        const reasoning = [message.reasoning, seededReasoning].filter(Boolean).join('\n\n');
        return { ...message, content: seededContent, reasoning: reasoning || undefined };
      }),
    };
  });
}
