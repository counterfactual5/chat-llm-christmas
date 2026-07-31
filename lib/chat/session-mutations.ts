import { mergeReviewChecks, type ReviewCheck } from '@/lib/tools/review/claim-reviewer';
import type { ChatSession, Message } from '@/lib/chat/types';
import {
  collectWebSourcesFromMessages,
  referenceSourceKind,
} from '@/lib/chat/references';
import {
  buildPersistedUserMessageContent,
  hasPersistedImageTranscription,
  imageRefsFromMessageImages,
  injectionBodyFromToolResults,
} from '@/lib/tools/image-understand/persist';
import { stripMessageStamp } from '@/lib/chat/time-context';

export type GeneratedFileInput = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  content?: string;
  createdAt?: number;
};

export type ToolRunInput = {
  name: string;
  status: 'start' | 'done';
  query?: string;
  provider?: string;
  results?: Array<{ title: string; url: string; snippet: string; body?: string }>;
  error?: string;
  targetTimestamp?: number;
};

export type ToolRunUpsertResult = {
  sessions: ChatSession[];
  /** Open the context panel when new reference sources appeared. */
  openContextPanel: boolean;
  /** Clear the UI-only webSourcesCleared latch when sources are restored. */
  unsetWebSourcesCleared: boolean;
};

function touchSession(session: ChatSession, patch: Partial<ChatSession>): ChatSession {
  return { ...session, ...patch, updatedAt: Date.now() };
}

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

export function withUpsertedReviewReport(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  report: Message['reviewReport'],
): ChatSession[] {
  if (!report) return sessions;
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    return touchSession(s, {
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m;
        const prevChecks = m.reviewReport?.checks || [];
        const mergedChecks = mergeReviewChecks(
          prevChecks as ReviewCheck[],
          report.checks as ReviewCheck[],
        );
        if (!mergedChecks.length) return m;
        const merged: NonNullable<Message['reviewReport']> = {
          ...report,
          checks: mergedChecks,
        };
        const toolReceipt = merged.checks.find((c) => c.kind === 'tool_receipt');
        const legacyFindings =
          toolReceipt?.items?.map((item, i) => ({
            id: `tool_receipt:${i}`,
            severity: item.severity,
            surface: 'tool',
            verdict: 'no_receipt',
            claim: item.title,
            evidence: item.detail,
          })) || [];
        return {
          ...m,
          reviewReport: merged,
          ...(merged.status === 'done' ? { reviewFindings: legacyFindings } : {}),
        };
      }),
    });
  });
}

export function withUpsertedReviewFindings(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  payload: {
    findings: Message['reviewFindings'];
    /** Allow clearing / recording a clean review. */
    allowEmpty?: boolean;
  },
): ChatSession[] {
  if (!payload.findings?.length && !payload.allowEmpty) return sessions;
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    return touchSession(s, {
      messages: s.messages.map((m) =>
        m.id === assistantId ? { ...m, reviewFindings: payload.findings || [] } : m,
      ),
    });
  });
}

export function withUpsertedAssistantToolRun(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  run: ToolRunInput,
): ToolRunUpsertResult {
  let openContextPanel = false;
  let unsetWebSourcesCleared = false;
  const nextSessions = sessions.map((s) => {
    if (s.id !== sessionId) return s;
    const msgs = s.messages.map((m) => {
      if (m.id !== assistantId) return m;
      if (run.provider === 'claim-reviewer') return m;
      const existing = m.toolRuns || [];
      const idx = existing.findIndex(
        (r) => r.name === run.name && r.query === run.query && r.status === 'start',
      );
      const pendingIdx =
        idx >= 0
          ? idx
          : run.status === 'done'
            ? existing.findIndex((r) => r.name === run.name && r.status === 'start')
            : -1;
      let toolRuns;
      let activity = [...(m.activity || [])];
      if (run.status === 'start') {
        const toolRunId = crypto.randomUUID();
        // A new start for the same tool while a previous one is still pending
        // usually means the earlier done was lost — close the orphan so it
        // doesn't spin forever under the new call.
        const closedOrphans = existing.map((r) =>
          r.name === run.name && r.status === 'start'
            ? {
                ...r,
                status: 'done' as const,
                error: r.error || 'Superseded by a later call',
              }
            : r,
        );
        toolRuns = [
          ...closedOrphans,
          {
            id: toolRunId,
            name: run.name,
            status: 'start' as const,
            query: run.query,
          },
        ];
        activity.push({
          id: crypto.randomUUID(),
          kind: 'tool',
          toolRunId,
        });
      } else if (pendingIdx >= 0) {
        toolRuns = existing.map((r, i) =>
          i === pendingIdx
            ? {
                ...r,
                status: 'done' as const,
                provider: run.provider,
                results: run.results,
                error: run.error,
              }
            : r,
        );
      } else {
        const toolRunId = crypto.randomUUID();
        toolRuns = [
          ...existing,
          {
            id: toolRunId,
            name: run.name,
            status: 'done' as const,
            query: run.query,
            provider: run.provider,
            results: run.results,
            error: run.error,
          },
        ];
        activity.push({
          id: crypto.randomUUID(),
          kind: 'tool',
          toolRunId,
        });
      }
      return { ...m, toolRuns, activity, incomplete: true };
    });
    let mergedMsgs = msgs;
    if (run.status === 'done') {
      // Tools actually ran — drop stale "Stopped before calling tools" stamp
      // left over from the pre-tool narration bubble.
      if (
        /web_search|web_read|web-read|proactive_search|image_understand/i.test(
          String(run.name || ''),
        ) &&
        !run.error
      ) {
        mergedMsgs = mergedMsgs.map((m) =>
          m.id === assistantId && m.truncationReason === 'Stopped before calling tools'
            ? { ...m, truncationReason: undefined }
            : m,
        );
      }
      const isImageUnderstand =
        run.name === 'image_understand' ||
        run.provider === 'zhipu-vision' ||
        run.provider === 'image-understand' ||
        run.provider === 'glm-ocr' ||
        run.provider === 'nemotron-omni';
      if (isImageUnderstand) {
        const { body, imageCount } = injectionBodyFromToolResults(run.results || []);
        if (body) {
          const aIdx = mergedMsgs.findIndex((m) => m.id === assistantId);
          // On-demand transcription of an older image (model-invoked tool):
          // results carry /api/files/<id> urls — persist onto the message
          // that owns that file so the image is only ever transcribed once.
          const runFileIds = (run.results || [])
            .map((r) => {
              const u = String(r?.url || '');
              return u.startsWith('/api/files/')
                ? decodeURIComponent(
                    u.slice('/api/files/'.length).split(/[?#]/)[0] || '',
                  )
                : '';
            })
            .filter(Boolean);
          let matchedByFileId = false;
          let targetIdx = -1;
          if (run.targetTimestamp != null) {
            targetIdx = mergedMsgs.findIndex(
              (m) => m.role === 'user' && m.timestamp === run.targetTimestamp,
            );
          } else if (runFileIds.length > 0) {
            targetIdx = mergedMsgs.findIndex(
              (m) =>
                m.role === 'user' &&
                (m.images || []).some(
                  (img) =>
                    (img.fileId && runFileIds.includes(img.fileId)) ||
                    runFileIds.some((id) => String(img.url || '').includes(id)),
                ),
            );
            matchedByFileId = targetIdx >= 0;
          }
          if (targetIdx < 0) targetIdx = aIdx - 1;
          if (targetIdx >= 0 && mergedMsgs[targetIdx]?.role === 'user') {
            const userMsg = mergedMsgs[targetIdx];
            // A single on-demand call covers one image; only persist when it
            // covers ALL images of that message, otherwise a partial
            // transcription would hide the remaining ones from text models.
            const coversAllImages =
              !matchedByFileId ||
              (userMsg.images?.length || 0) <= (run.results?.length || 0);
            if (
              coversAllImages &&
              !hasPersistedImageTranscription(userMsg.content || '') &&
              (userMsg.images?.length || 0) > 0
            ) {
              mergedMsgs = mergedMsgs.map((m, i) =>
                i === targetIdx
                  ? {
                      ...userMsg,
                      content: buildPersistedUserMessageContent(
                        userMsg.content,
                        body,
                        imageCount || run.results?.length || 1,
                        imageRefsFromMessageImages(userMsg.images),
                      ),
                      // Keep thumbnails in UI; API drops images once transcription is present.
                    }
                  : m,
              );
            }
          }
        }
      } else {
        const nextSession = touchSession(s, { messages: mergedMsgs });
        if (s.webSourcesCleared) {
          const sourceByUrl = new Map((s.webSources || []).map((source) => [source.url, source]));
          for (const result of run.results || []) {
            if (!result.url || /^(data:|blob:|\/)/i.test(result.url)) continue;
            sourceByUrl.set(result.url, {
              title: result.title,
              url: result.url,
              snippet: result.snippet,
              provider: run.provider,
              query: run.query,
              sourceKind: referenceSourceKind(run.provider, run.name),
            });
          }
          nextSession.webSources = [...sourceByUrl.values()].slice(-40);
        } else {
          nextSession.webSources = collectWebSourcesFromMessages(mergedMsgs);
        }
        if ((nextSession.webSources?.length || 0) > 0) {
          if (!s.webSourcesCleared) unsetWebSourcesCleared = true;
          openContextPanel = true;
        }
        return nextSession;
      }
    }
    return touchSession(s, { messages: mergedMsgs });
  });
  return {
    sessions: nextSessions,
    openContextPanel,
    unsetWebSourcesCleared,
  };
}

/** Close any tool runs still marked start when the stream settles. */
export function withSettledOpenToolRuns(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
): ChatSession[] {
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    const msgs = s.messages.map((m) => {
      if (m.id !== assistantId || !m.toolRuns?.some((r) => r.status === 'start')) return m;
      return {
        ...m,
        toolRuns: m.toolRuns.map((r) =>
          r.status === 'start' ? { ...r, status: 'done' as const } : r,
        ),
      };
    });
    return { ...s, messages: msgs };
  });
}

/** Promote orphan reasoning into content when the bubble body is empty. */
export function withPromotedOrphanReasoning(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  orphan: string,
): ChatSession[] {
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    return touchSession(s, {
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m;
        return {
          ...m,
          content: orphan,
          reasoning: undefined,
          activity: (m.activity || []).filter((a) => a.kind !== 'reasoning'),
        };
      }),
    });
  });
}

export function withEmptyReplyFallback(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  fallback: string,
): ChatSession[] {
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    return touchSession(s, {
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m;
        return {
          ...m,
          content: fallback,
          incomplete: false,
          truncationReason: undefined,
        };
      }),
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
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    return {
      ...s,
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m;
        const mergedReasoning = [m.reasoning, seededReasoning].filter(Boolean).join('\n\n');
        return {
          ...m,
          content: seededContent,
          reasoning: mergedReasoning || undefined,
        };
      }),
    };
  });
}

export function serializeReviewToolRuns(
  runs: NonNullable<Message['toolRuns']> | undefined,
) {
  return (runs || []).map((r) => ({
    name: r.name,
    status: r.status,
    query: r.query,
    error: r.error,
    provider: r.provider,
    results: (r.results || [])
      .filter((x) => x?.url || x?.snippet || x?.body)
      .slice(0, 20)
      .map((x) => ({
        url: x.url,
        title: x.title,
        snippet: x.snippet,
        ...(x.body ? { body: String(x.body).slice(0, 16_000) } : {}),
      })),
  }));
}
