/**
 * Append/update assistant content, reasoning, files, incomplete flags.
 */

import type { ChatSession, ToolViewPayload } from '@/lib/chat/types';
import { stripMessageStamp } from '@/lib/chat/context/time-context';
import type {
  GeneratedFileInput,
  ToolViewInput,
} from '@/lib/chat/session/mutations/types';
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
    ...(typeof file.contentRev === 'number' ? { contentRev: file.contentRev } : {}),
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

/** Refresh an existing generated file entry in place (same fileId after office write). */
export function withUpdatedAssistantGeneratedFile(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  file: GeneratedFileInput,
): ChatSession[] {
  const entryId = String(file.id || '').trim();
  if (!entryId) return sessions;
  let found = false;
  const next = sessions.map((s) => {
    if (s.id !== sessionId) return s;
    return touchSession(s, {
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m;
        const existing = m.files || [];
        if (!existing.some((f) => f.id === entryId)) return m;
        found = true;
        return {
          ...m,
          files: existing.map((f) => {
            if (f.id !== entryId) return f;
            return {
              ...f,
              name: String(file.name || f.name || 'file').trim() || f.name,
              mimeType:
                String(file.mimeType || f.mimeType || 'application/octet-stream').trim() ||
                f.mimeType,
              size: typeof file.size === 'number' ? file.size : f.size,
              url: String(file.url || f.url || '').trim() || f.url,
              createdAt:
                typeof file.createdAt === 'number' ? file.createdAt : f.createdAt,
              ...(typeof file.contentRev === 'number'
                ? { contentRev: file.contentRev }
                : {}),
            };
          }),
        };
      }),
    });
  });
  // If the file wasn't on this assistant turn (user attachment / older turn),
  // still append so Output can surface the refreshed id.
  if (!found) {
    return withAppendedAssistantGeneratedFile(sessions, sessionId, assistantId, file);
  }
  return next;
}

export function withAppendedAssistantToolView(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  view: ToolViewInput,
): ChatSession[] {
  const entry: ToolViewPayload = {
    id: String(view.id || '').trim(),
    viewType: String(view.viewType || '').trim() || 'unknown',
    title: String(view.title || '').trim() || 'View',
    ...(view.sourceFileId
      ? { sourceFileId: String(view.sourceFileId).trim() }
      : {}),
    ...(view.sourceFileName
      ? { sourceFileName: String(view.sourceFileName).trim() }
      : {}),
    createdAt: typeof view.createdAt === 'number' ? view.createdAt : Date.now(),
    data: view.data ?? null,
  };
  if (!entry.id) return sessions;
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    return touchSession(s, {
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m;
        const existing = m.views || [];
        if (existing.some((v) => v.id === entry.id)) return m;
        const activity = [...(m.activity || [])];
        const alreadyInTimeline = activity.some(
          (step) => step.kind === 'view' && step.viewId === entry.id,
        );
        if (!alreadyInTimeline) {
          activity.push({
            id: `${assistantId}-view-${entry.id}`,
            kind: 'view',
            viewId: entry.id,
          });
        }
        return {
          ...m,
          views: [...existing, entry],
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
      // Append to the last step when it is already reasoning.
      if (last?.kind === 'reasoning') {
        activity[activity.length - 1] = {
          ...last,
          text: last.text + chunk,
        };
        return {
          ...m,
          reasoning: (m.reasoning || '') + chunk,
          activity,
          incomplete: true,
        };
      }
      // Models can interleave CoT with answer text while writing a report. Only
      // merge back into the earlier Thought step when nothing tool-like has run
      // since that Thought — i.e. the trailing run is pure answer content. A real
      // tool (or file/view/stage) still forks a new Thought step so the timeline
      // stays chronological (think → search → think).
      if (last?.kind === 'content') {
        const idx = activity.findLastIndex((st) => st.kind === 'reasoning');
        const prev = idx >= 0 ? activity[idx] : undefined;
        if (prev && prev.kind === 'reasoning') {
          const interveningTool = activity
            .slice(idx + 1)
            .some((st) => st.kind !== 'content');
          if (!interveningTool) {
            activity.splice(idx, 1);
            activity.push({
              id: prev.id,
              kind: 'reasoning',
              text: prev.text + chunk,
            });
          } else {
            activity.push({
              id: crypto.randomUUID(),
              kind: 'reasoning',
              text: chunk,
            });
          }
        } else {
          activity.push({
            id: crypto.randomUUID(),
            kind: 'reasoning',
            text: chunk,
          });
        }
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

