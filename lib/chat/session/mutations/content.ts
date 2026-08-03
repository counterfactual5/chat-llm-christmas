/**
 * Append/update assistant content, reasoning, files, incomplete flags.
 */

import type { ChatSession } from '@/lib/chat/types';
import { stripMessageStamp } from '@/lib/chat/context/time-context';
import type { GeneratedFileInput } from '@/lib/chat/session/mutations/types';
import { touchSession } from '@/lib/chat/session/mutations/shared';

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
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    return touchSession(s, {
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m;
        const existing = m.files || [];
        if (existing.some((f) => f.id === entry.id)) return m;
        const activity = [...(m.activity || [])];
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
        return {
          ...m,
          files: [...existing, entry],
          activity,
        };
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
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    return touchSession(s, {
      messages: s.messages.map((m) =>
        m.id === assistantId
          ? {
              ...m,
              incomplete,
              finishReason: meta?.finishReason ?? m.finishReason,
              truncationReason: incomplete ? meta?.truncationReason : undefined,
              ...(!incomplete ? { reviewFixStreaming: false } : {}),
            }
          : m,
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
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    if (!s.messages.some((m) => m.id === assistantId)) return s;
    const msgs = s.messages.map((m) => {
      if (m.id !== assistantId) return m;
      const nextContent = stripMessageStamp(m.content + chunk);
      const activity = [...(m.activity || [])];
      const last = activity[activity.length - 1];
      // Mirror content into the timeline so Process / answer can interleave
      // in arrival order (think → answer → tool → answer…).
      if (last?.kind === 'content') {
        activity[activity.length - 1] = {
          ...last,
          text: last.text + chunk,
        };
      } else {
        activity.push({
          id: crypto.randomUUID(),
          kind: 'content',
          text: chunk,
        });
      }
      return { ...m, content: nextContent, activity, incomplete: true };
    });
    return touchSession(s, { messages: msgs });
  });
}

export function withAppendedAssistantReviewFix(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  payload: { status?: 'start' | 'done'; content?: string },
): ChatSession[] {
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    if (!s.messages.some((m) => m.id === assistantId)) return s;
    const msgs = s.messages.map((m) => {
      if (m.id !== assistantId) return m;
      if (payload.status === 'start') {
        return { ...m, reviewFix: '', reviewFixStreaming: true, incomplete: true };
      }
      if (payload.status === 'done') {
        return { ...m, reviewFixStreaming: false };
      }
      if (payload.content) {
        return {
          ...m,
          reviewFix: String(m.reviewFix || '') + payload.content,
          reviewFixStreaming: true,
          incomplete: true,
        };
      }
      return m;
    });
    return touchSession(s, { messages: msgs });
  });
}

export function withAppendedAssistantReasoning(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  chunk: string,
): ChatSession[] {
  if (!chunk) return sessions;
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    if (!s.messages.some((m) => m.id === assistantId)) return s;
    const msgs = s.messages.map((m) => {
      if (m.id !== assistantId) return m;
      const activity = [...(m.activity || [])];
      const last = activity[activity.length - 1];
      // Only append to the last step when it is already reasoning.
      // After a tool runs, start a new reasoning step so the timeline stays
      // chronological: think → search → think (tool sits in the middle).
      if (last?.kind === 'reasoning') {
        activity[activity.length - 1] = {
          ...last,
          text: last.text + chunk,
        };
      } else {
        activity.push({
          id: crypto.randomUUID(),
          kind: 'reasoning',
          text: chunk,
        });
      }
      return {
        ...m,
        reasoning: (m.reasoning || '') + chunk,
        activity,
        incomplete: true,
      };
    });
    return touchSession(s, { messages: msgs });
  });
}

/**
 * Orphan </think> arrived after content was already streamed into the bubble.
 * Move that bubble text into Thought and clear the answer body so the real
 * reply can follow.
 */
export function withRewoundAssistantContentToReasoning(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
): ChatSession[] {
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    return touchSession(s, {
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m;
        const leaked = String(m.content || '').trim();
        if (!leaked) return m;
        const activity = [...(m.activity || [])].filter((step) => step.kind !== 'content');
        const last = activity[activity.length - 1];
        if (last?.kind === 'reasoning') {
          activity[activity.length - 1] = {
            ...last,
            text: `${last.text}${last.text ? '\n\n' : ''}${leaked}`,
          };
        } else {
          activity.push({
            id: crypto.randomUUID(),
            kind: 'reasoning',
            text: leaked,
          });
        }
        return {
          ...m,
          content: '',
          reasoning: [m.reasoning, leaked].filter(Boolean).join('\n\n'),
          activity,
          incomplete: true,
        };
      }),
    });
  });
}

