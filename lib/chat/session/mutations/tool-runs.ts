/**
 * Assistant tool-run upsert + settle open runs.
 */

import type { ChatSession } from '@/lib/chat/types';
import {
  collectWebSourcesFromMessages,
  referenceSourceKind,
} from '@/lib/chat/context/references';
import {
  buildPersistedUserMessageContent,
  hasPersistedImageTranscription,
  imageRefsFromMessageImages,
  injectionBodyFromToolResults,
} from '@/lib/tools/image-understand/persist';
import type { ToolRunInput, ToolRunUpsertResult } from '@/lib/chat/session/mutations/types';
import { touchSession } from '@/lib/chat/session/mutations/shared';

/** Normalize tool-run query for matching parallel same-tool calls. */
function toolRunQueryKey(query: string | undefined): string {
  return String(query || '').trim();
}

function toolRunCallId(callId: string | undefined): string {
  return String(callId || '').trim();
}

function sameToolQuery(
  a: { name: string; query?: string },
  b: { name: string; query?: string },
): boolean {
  return a.name === b.name && toolRunQueryKey(a.query) === toolRunQueryKey(b.query);
}

function findPendingToolRunIndex(
  existing: Array<{ name: string; query?: string; callId?: string; status: string }>,
  run: { name: string; query?: string; callId?: string },
): number {
  const callId = toolRunCallId(run.callId);
  if (callId) {
    const byCall = existing.findIndex(
      (r) => r.status === 'start' && toolRunCallId(r.callId) === callId,
    );
    if (byCall >= 0) return byCall;
  }
  const byQuery = existing.findIndex(
    (r) => sameToolQuery(r, run) && r.status === 'start',
  );
  if (byQuery >= 0) return byQuery;

  const nameOnlyPending = existing
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.name === run.name && r.status === 'start');
  if (toolRunQueryKey(run.query)) {
    return nameOnlyPending.length === 1 ? nameOnlyPending[0]!.i : -1;
  }
  return nameOnlyPending[0]?.i ?? -1;
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
      // Prefer callId, then name+query, so parallel same-tool calls don't steal
      // each other's done events. Name-only fallback only when the event has no
      // query (tools that never send one) or exactly one pending start remains.
      const idx =
        run.status === 'done' || run.status === 'awaiting_approval'
          ? findPendingToolRunIndex(existing, run)
          : -1;
      const pendingIdx = idx;
      const awaitingIdx =
        run.status === 'done'
          ? existing.findIndex(
              (r) =>
                r.name === run.name &&
                (r.status === 'awaiting_approval' ||
                  (run.approval?.callId &&
                    r.approval?.callId === run.approval.callId)),
            )
          : -1;
      let toolRuns;
      let activity = [...(m.activity || [])];
      if (run.status === 'start') {
        const toolRunId = crypto.randomUUID();
        const incomingCallId = toolRunCallId(run.callId);
        // Close only a true retry of the *same* call (same callId), or — when
        // callId is absent (slash / legacy) — the same name+query start.
        const closedOrphans = existing.map((r) => {
          const retrySameCall =
            Boolean(incomingCallId) &&
            r.status === 'start' &&
            toolRunCallId(r.callId) === incomingCallId;
          const legacySameQuery =
            !incomingCallId && sameToolQuery(r, run) && r.status === 'start';
          if (!retrySameCall && !legacySameQuery) return r;
          return {
            ...r,
            status: 'done' as const,
            error: r.error || 'Superseded by a later call',
          };
        });
        toolRuns = [
          ...closedOrphans,
          {
            id: toolRunId,
            name: run.name,
            status: 'start' as const,
            query: run.query,
            callId: incomingCallId || undefined,
            approval: run.approval,
          },
        ];
        activity.push({
          id: crypto.randomUUID(),
          kind: 'tool',
          toolRunId,
        });
      } else if (run.status === 'awaiting_approval' && pendingIdx >= 0) {
        toolRuns = existing.map((r, i) =>
          i === pendingIdx
            ? {
                ...r,
                status: 'awaiting_approval' as const,
                provider: run.provider || r.provider,
                query: run.query ?? r.query,
                callId: toolRunCallId(run.callId) || r.callId,
                approval: run.approval || r.approval,
              }
            : r,
        );
      } else if (run.status === 'awaiting_approval') {
        const toolRunId = crypto.randomUUID();
        toolRuns = [
          ...existing,
          {
            id: toolRunId,
            name: run.name,
            status: 'awaiting_approval' as const,
            query: run.query,
            callId: toolRunCallId(run.callId) || undefined,
            provider: run.provider,
            approval: run.approval,
          },
        ];
        activity.push({
          id: crypto.randomUUID(),
          kind: 'tool',
          toolRunId,
        });
      } else if (pendingIdx >= 0 || awaitingIdx >= 0) {
        const targetIdx = pendingIdx >= 0 ? pendingIdx : awaitingIdx;
        toolRuns = existing.map((r, i) =>
          i === targetIdx
            ? {
                ...r,
                status: 'done' as const,
                provider: run.provider || r.provider,
                query: run.query ?? r.query,
                callId: toolRunCallId(run.callId) || r.callId,
                results: run.results,
                error: run.error,
                approval: run.approval ?? r.approval,
                approvalOutcome: run.approvalOutcome ?? r.approvalOutcome,
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
            callId: toolRunCallId(run.callId) || undefined,
            provider: run.provider,
            results: run.results,
            error: run.error,
            approval: run.approval,
            approvalOutcome: run.approvalOutcome,
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
        /web_search|web_read|web-read|proactive_search|image_understand|file_read|paper_search|book_search|book_download|paper_download|generate_image/i.test(
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

/** Patch a specific tool run after the user confirms or cancels Gmail send. */
export function withResolvedGmailApproval(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  toolRunId: string,
  outcome: {
    approvalOutcome: 'sent' | 'cancelled';
    error?: string;
    results?: Array<{ title: string; url: string; snippet: string; body?: string }>;
  },
): ChatSession[] {
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    const msgs = s.messages.map((m) => {
      if (m.id !== assistantId) return m;
      return {
        ...m,
        toolRuns: (m.toolRuns || []).map((r) =>
          r.id === toolRunId
            ? {
                ...r,
                status: 'done' as const,
                approvalOutcome: outcome.approvalOutcome,
                error: outcome.error,
                results: outcome.results ?? r.results,
              }
            : r,
        ),
      };
    });
    return touchSession(s, { messages: msgs });
  });
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
          r.status === 'start'
            ? {
                ...r,
                status: 'done' as const,
                // Manual `/review` Process cards must not look successful when
                // the stream died before their matching done event arrived.
                ...(r.provider === 'review' && !r.error
                  ? { error: 'Interrupted' }
                  : {}),
              }
            : r,
        ),
      };
    });
    return { ...s, messages: msgs };
  });
}

/** Promote orphan reasoning into content when the bubble body is empty. */

