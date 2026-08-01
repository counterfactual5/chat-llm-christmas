import type { ChatSession, WebSearchSource } from '@/lib/chat/types';
import { formatWebSourcesForReference } from '@/lib/chat/context/references';
import { analyzeTruncation } from '@/lib/chat/stream/reply-truncation';
import {
  contentHasThinkMarkup,
  createThinkStreamParser,
  extractThinkBlocks,
} from '@/lib/chat/message/think-tags';
import {
  contentHasToolMarkup,
  createToolCallStripper,
  stripFakeToolMarkup,
} from '@/lib/chat/message/tool-tags';
import { normalizeGoogleIntegrations } from '@/lib/integrations/google/services';
import {
  withAppendedAssistantContent,
  withAppendedAssistantGeneratedFile,
  withAppendedAssistantReasoning,
  withAppendedAssistantReviewFix,
  withEmptyReplyFallback,
  withMarkedAssistantIncomplete,
  withPromotedOrphanReasoning,
  withSeededAssistantCleanup,
  withSettledOpenToolRuns,
  withUpsertedAssistantToolRun,
  withUpsertedReviewFindings,
  withUpsertedReviewReport,
  serializeReviewToolRuns,
  type GeneratedFileInput,
} from '@/lib/chat/session/mutations';

export type StreamChatApiMessage = ReturnType<
  typeof import('@/lib/chat/message/api-messages').toApiMessages
>;

export type StreamChatDeps = {
  getSessions: () => ChatSession[];
  setSessions: (updater: (prev: ChatSession[]) => ChatSession[]) => void;
  selectedModel: string;
  systemPrompt: string;
  skillsPayloadForSession: (
    sessionId: string,
  ) => Array<{ id: string; title: string; content: string }>;
  memoriesPayload: () => Array<{ id: string; kind: string; content: string }>;
  getNotionConnected: () => boolean;
  getGitHubConnected: () => boolean;
  getGoogleConnected: () => boolean;
  getActiveSessionId: () => string;
  scrollToBottom: () => void;
  fetchSkills: () => void | Promise<void>;
  onGeneratedFileForActiveSession: () => void;
  onWebSourcesUpdated: (opts: {
    openContextPanel: boolean;
    unsetWebSourcesCleared: boolean;
  }) => void;
  /** Fired after a normal reply settles so memory extraction can run off-path. */
  onReplySettled?: (opts: {
    sessionId: string;
    requestReview?: boolean;
    incomplete: boolean;
  }) => void;
};

export async function streamChatResponse(
  deps: StreamChatDeps,
  sessionId: string,
  apiMessages: StreamChatApiMessage,
  assistantId: string,
  signal: AbortSignal,
  /** Text already present in the bubble, so Resume analyzes the whole reply. */
  initialContent = '',
  /** Inserted before the first resumed chunk to keep Markdown structure intact. */
  seamPrefix = '',
  /** Prefer sources from the truncated thread (edit/resend), not a stale ref. */
  webSourcesOverride?: WebSearchSource[],
  /** Command layer: one-off claim review of the latest assistant answer. */
  requestReview?: boolean,
) {
  const sessions = deps.getSessions();
  const session = sessions.find((s) => s.id === sessionId);
  const sessionSources = webSourcesOverride ?? session?.webSources ?? [];
  const combinedReference = formatWebSourcesForReference(sessionSources);

  const notionConnected = deps.getNotionConnected();
  const githubConnected = deps.getGitHubConnected();
  const googleConnected = deps.getGoogleConnected();
  const integrations = normalizeGoogleIntegrations(
    deps.getSessions().find((s) => s.id === sessionId)?.mcpIds || [],
  ).filter((id) => {
    if (id === 'notion') return notionConnected;
    if (id === 'github') return githubConnected;
    if (id === 'gmail' || id === 'calendar' || id === 'drive') return googleConnected;
    // No OAuth — server authorizes via bound CPA key.
    if (id === 'zhipu-vision') return true;
    return false;
  });

  const sessionForReview = deps.getSessions().find((s) => s.id === sessionId);
  const assistantTurnsForReview = requestReview
    ? (sessionForReview?.messages || [])
        .filter((m) => m.role === 'assistant' && String(m.content || '').trim())
        .map((m) => ({
          messageId: m.id,
          assistantText: m.content,
          toolRuns: serializeReviewToolRuns(m.toolRuns),
        }))
    : [];
  const lastAssistantForReview = assistantTurnsForReview.length
    ? assistantTurnsForReview[assistantTurnsForReview.length - 1]
    : undefined;

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: apiMessages,
      model: deps.selectedModel,
      systemPrompt: deps.systemPrompt,
      referenceText: combinedReference,
      skills: deps.skillsPayloadForSession(sessionId),
      memories: deps.memoriesPayload(),
      conversationId: sessionId,
      integrations,
      autoReview: deps.getSessions().find((s) => s.id === sessionId)?.autoReview ?? true,
      ...(requestReview && lastAssistantForReview
        ? {
            requestReview: true,
            reviewContext: {
              targetMessageId: lastAssistantForReview.messageId,
              assistantText: lastAssistantForReview.assistantText,
              toolRuns: lastAssistantForReview.toolRuns,
              turns: assistantTurnsForReview,
            },
          }
        : requestReview
          ? { requestReview: true }
          : {}),
    }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || 'Upstream error');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason: string | null = null;
  let serverTruncated: boolean | null = null;
  let serverTruncationReason: string | undefined;
  let seamPending = Boolean(seamPrefix);
  let sawDone = false;
  const thinkParser = createThinkStreamParser();
  const toolStripper = createToolCallStripper();

  // Clean any leaked <think> / fake tool markup already in the bubble (history / Resume).
  const seededThink = extractThinkBlocks(initialContent);
  const seededContent = stripFakeToolMarkup(seededThink.content);
  let streamed = seededContent;
  if (contentHasThinkMarkup(initialContent) || contentHasToolMarkup(initialContent)) {
    deps.setSessions((prev) =>
      withSeededAssistantCleanup(
        prev,
        sessionId,
        assistantId,
        seededContent,
        seededThink.reasoning || undefined,
      ),
    );
  }
  // Keep parsers in sync if the previous reply was cut mid-tag.
  if (initialContent) {
    const seededSplit = thinkParser.push(initialContent);
    if (seededSplit.content) toolStripper.push(seededSplit.content);
  }

  const markAssistantIncomplete = (
    incomplete: boolean,
    meta?: { finishReason?: string | null; truncationReason?: string },
  ) => {
    deps.setSessions((prev) =>
      withMarkedAssistantIncomplete(prev, sessionId, assistantId, incomplete, meta),
    );
  };

  const appendToAssistant = (chunk: string) => {
    deps.setSessions((prev) =>
      withAppendedAssistantContent(prev, sessionId, assistantId, chunk),
    );
  };

  const appendToAssistantReasoning = (chunk: string) => {
    deps.setSessions((prev) =>
      withAppendedAssistantReasoning(prev, sessionId, assistantId, chunk),
    );
  };

  const emitContent = (chunk: string) => {
    const cleaned = toolStripper.push(chunk);
    if (!cleaned) return;
    streamed += cleaned;
    appendToAssistant(cleaned);
    if (sessionId === deps.getActiveSessionId()) deps.scrollToBottom();
  };

  const applyThinkSplit = (raw: string) => {
    const split = thinkParser.push(raw);
    if (split.reasoning) {
      appendToAssistantReasoning(split.reasoning);
    }
    if (split.content) emitContent(split.content);
  };

  const settle = (unexpectedEnd = false) => {
    deps.setSessions((prev) => withSettledOpenToolRuns(prev, sessionId, assistantId));

    const flushed = thinkParser.flush();
    if (flushed.reasoning) appendToAssistantReasoning(flushed.reasoning);
    if (flushed.content) {
      const cleaned = toolStripper.push(flushed.content) + toolStripper.flush();
      if (cleaned) {
        streamed += cleaned;
        appendToAssistant(cleaned);
      }
    } else {
      const cleaned = toolStripper.flush();
      if (cleaned) {
        streamed += cleaned;
        appendToAssistant(cleaned);
      }
    }

    // Safety net: some gateways put the whole answer in reasoning with empty
    // content. Promote it to the bubble body so the UI is not "Thought only".
    if (!streamed.trim()) {
      const live = deps
        .getSessions()
        .find((s) => s.id === sessionId)
        ?.messages.find((m) => m.id === assistantId);
      const orphan = String(live?.reasoning || '').trim();
      if (orphan) {
        streamed = orphan;
        deps.setSessions((prev) =>
          withPromotedOrphanReasoning(prev, sessionId, assistantId, orphan),
        );
      }
    }

    // Truly empty reply (no content, no reasoning): never leave a blank bubble.
    // Treat as a failed request so the user sees Retry instead of empty space.
    if (!streamed.trim()) {
      const fallback =
        'Error: The model returned an empty reply. Please try again, or switch to another model.';
      streamed = fallback;
      deps.setSessions((prev) =>
        withEmptyReplyFallback(prev, sessionId, assistantId, fallback),
      );
      markAssistantIncomplete(false, {
        finishReason: finishReason || 'error',
      });
      return;
    }

    // Connection dropped / function killed mid-stream: no [DONE] arrived.
    // Prefer Continue over silently treating the partial reply as finished.
    if (unexpectedEnd && !finishReason && serverTruncated == null) {
      markAssistantIncomplete(true, {
        finishReason,
        truncationReason: 'Stream ended unexpectedly',
      });
      return;
    }
    const verdict = analyzeTruncation(
      streamed,
      finishReason,
      unexpectedEnd || thinkParser.inThink,
      undefined,
      {
        serverTruncated,
        serverReason: serverTruncationReason,
      },
    );
    markAssistantIncomplete(verdict.truncated, {
      finishReason,
      truncationReason: verdict.reason || undefined,
    });
    deps.onReplySettled?.({
      sessionId,
      requestReview: Boolean(requestReview),
      incomplete: verdict.truncated,
    });
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') {
        sawDone = true;
        settle(false);
        return;
      }
      try {
        const parsed = JSON.parse(data);
        if (parsed.finish_reason) finishReason = parsed.finish_reason;
        if (typeof parsed.truncated === 'boolean') {
          serverTruncated = parsed.truncated;
        }
        if (typeof parsed.truncation_reason === 'string' && parsed.truncation_reason) {
          serverTruncationReason = parsed.truncation_reason;
        }
        if (parsed.reasoning) {
          appendToAssistantReasoning(parsed.reasoning);
        }
        if (parsed.reviewer_report?.checks) {
          deps.setSessions((prev) =>
            withUpsertedReviewReport(
              prev,
              sessionId,
              parsed.reviewer_report.targetMessageId || assistantId,
              {
                phase: parsed.reviewer_report.phase,
                status: parsed.reviewer_report.status === 'running' ? 'running' : 'done',
                checks: parsed.reviewer_report.checks,
              },
            ),
          );
        } else if (Array.isArray(parsed.reviewer_findings?.findings)) {
          deps.setSessions((prev) =>
            withUpsertedReviewFindings(
              prev,
              sessionId,
              parsed.reviewer_findings.targetMessageId || assistantId,
              {
                findings: parsed.reviewer_findings.findings,
                allowEmpty: true,
              },
            ),
          );
        }
        if (parsed.review_fix) {
          const fix = parsed.review_fix as {
            status?: 'start' | 'done';
            content?: string;
          };
          deps.setSessions((prev) =>
            withAppendedAssistantReviewFix(prev, sessionId, assistantId, {
              status: fix.status,
              content: typeof fix.content === 'string' ? fix.content : undefined,
            }),
          );
        }
        if (parsed.tool) {
          let sideEffects = {
            openContextPanel: false,
            unsetWebSourcesCleared: false,
          };
          deps.setSessions((prev) => {
            const result = withUpsertedAssistantToolRun(prev, sessionId, assistantId, {
              name: String(parsed.tool.name || 'web_search'),
              status: parsed.tool.status === 'done' ? 'done' : 'start',
              query: parsed.tool.query,
              provider: parsed.tool.provider,
              results: Array.isArray(parsed.tool.results) ? parsed.tool.results : undefined,
              error: parsed.tool.error,
              targetTimestamp:
                typeof parsed.tool.targetTimestamp === 'number'
                  ? parsed.tool.targetTimestamp
                  : undefined,
            });
            sideEffects = {
              openContextPanel: result.openContextPanel,
              unsetWebSourcesCleared: result.unsetWebSourcesCleared,
            };
            return result.sessions;
          });
          if (sideEffects.openContextPanel || sideEffects.unsetWebSourcesCleared) {
            deps.onWebSourcesUpdated(sideEffects);
          }
          // save_skill persisted to the account — refresh the sidebar list.
          // Skill Creator stays active so the user can iterate / replace next.
          if (
            parsed.tool.status === 'done' &&
            parsed.tool.name === 'save_skill' &&
            !parsed.tool.error
          ) {
            void deps.fetchSkills();
          }
        }
        if (parsed.file_created && typeof parsed.file_created === 'object') {
          const raw = parsed.file_created as Record<string, unknown>;
          const file: GeneratedFileInput = {
            id: String(raw.id || ''),
            name: String(raw.name || ''),
            mimeType: String(raw.mimeType || 'text/plain'),
            size: typeof raw.size === 'number' ? raw.size : 0,
            url: String(raw.url || ''),
            content: typeof raw.content === 'string' ? raw.content : undefined,
            createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
          };
          deps.setSessions((prev) =>
            withAppendedAssistantGeneratedFile(prev, sessionId, assistantId, file),
          );
          if (sessionId === deps.getActiveSessionId()) {
            deps.onGeneratedFileForActiveSession();
          }
        }
        if (parsed.content) {
          let chunk = parsed.content as string;
          if (seamPending) {
            seamPending = false;
            // Skip the seam if the model already emitted the break itself.
            if (!chunk.startsWith('\n')) chunk = seamPrefix + chunk;
          }
          applyThinkSplit(chunk);
        }
      } catch {
        // Ignore malformed SSE payloads.
      }
    }
  }

  settle(!sawDone);
}
