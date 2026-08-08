import type { ChatSession, WebSearchSource } from '@/lib/chat/types';
import { formatWebSourcesForReference } from '@/lib/chat/context/references';
import {
  analyzeTruncation,
  looksAbruptlyCutOff,
  structuralTruncation,
} from '@/lib/chat/stream/reply-truncation';
import {
  actionFromStreamCode,
  NATURAL_FINISH_REASONS,
  RECOVERABLE_TOOL_TIMEOUT_REASON,
} from '@/lib/chat/stream/truncation';
import {
  readCompletionUsage,
  type CompletionUsage,
} from '@/lib/chat/stream/usage';
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
import { isOptionalBuiltinToolId } from '@/lib/tools/optional-builtins';
import {
  withAppendedAssistantContent,
  withAppendedAssistantGeneratedFile,
  withAppendedAssistantToolView,
  withAppendedAssistantReasoning,
  withAppendedAssistantReviewFix,
  withEmptyReplyFallback,
  withMarkedAssistantIncomplete,
  withPromotedOrphanReasoning,
  withRewoundAssistantContentToReasoning,
  withSeededAssistantCleanup,
  withSettledOpenToolRuns,
  withUpsertedAssistantToolRun,
  withUpsertedReviewFindings,
  withUpsertedReviewReport,
  serializeReviewToolRuns,
  settleEmptyBodyAction,
  type GeneratedFileInput,
  type ToolViewInput,
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
  /** When false, server should not promise auto-memory and client sends no facts. Default true. */
  memoriesEnabled?: () => boolean;
  getNotionConnected: () => boolean;
  getGitHubConnected: () => boolean;
  getGoogleConnected: () => boolean;
  getActiveSessionId: () => string;
  scrollToBottom: () => void;
  fetchSkills: () => void | Promise<void>;
  onGeneratedFileForActiveSession: () => void;
  /** Open specialized tool view in the preview panel when SSE view_created arrives. */
  onViewCreatedForActiveSession?: (view: ToolViewInput) => void;
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
  /** Google toggle on but vault token missing / unauthorized for this request. */
  onGoogleAuthRequired?: () => void;
  /** Notion toggle on but vault token missing / unauthorized for this request. */
  onNotionAuthRequired?: () => void;
  /** GitHub toggle on but vault token missing / unauthorized for this request. */
  onGitHubAuthRequired?: () => void;
  /** Unreadable SSE payloads were skipped during this stream. */
  onMalformedSse?: (message: string) => void;
  /** Gateway-reported usage from the final (or early-done) completion. */
  onCompletionUsage?: (usage: CompletionUsage) => void;
};

export type StreamChatRequestOpts = {
  /** When false, server skips web_search tools for this turn. */
  enableSearch?: boolean;
  /** Override session MCP/tool integrations (e.g. [] for tools-off polish). */
  integrations?: string[];
  autoReview?: boolean;
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
  /** Per-request overrides (tools-off polish, etc.). */
  requestOpts?: StreamChatRequestOpts,
): Promise<string> {
  const sessions = deps.getSessions();
  const session = sessions.find((s) => s.id === sessionId);
  const sessionSources = webSourcesOverride ?? session?.webSources ?? [];
  const combinedReference = formatWebSourcesForReference(sessionSources);
  // file_read rehydrates via chat-api extract sidecar — do not ship full
  // extracts in the /api/chat JSON body (Vercel ~4.5MB + session bloat).

  const notionConnected = deps.getNotionConnected();
  const githubConnected = deps.getGitHubConnected();
  const googleConnected = deps.getGoogleConnected();
  const sessionIntegrations = normalizeGoogleIntegrations(
    deps.getSessions().find((s) => s.id === sessionId)?.mcpIds || [],
  ).filter((id) => {
    if (id === 'notion') return notionConnected;
    if (id === 'github') return githubConnected;
    if (id === 'gmail' || id === 'calendar' || id === 'drive') return googleConnected;
    // No OAuth — server authorizes via bound CPA key.
    if (id === 'zhipu-vision') return true;
    if (isOptionalBuiltinToolId(id)) return true;
    return false;
  });
  const integrations =
    requestOpts?.integrations !== undefined
      ? requestOpts.integrations
      : sessionIntegrations;
  const sessionForReview = deps.getSessions().find((s) => s.id === sessionId);
  // `/review` audits the latest assistant reply by default (not the whole thread).
  // Server still accepts a `turns` array if a future client wants multi-turn.
  const assistantTurnsForReview = requestReview
    ? (() => {
        const turns = (sessionForReview?.messages || [])
          .filter((m) => m.role === 'assistant' && String(m.content || '').trim())
          .map((m) => ({
            messageId: m.id,
            assistantText: m.content,
            toolRuns: serializeReviewToolRuns(m.toolRuns),
          }));
        return turns.length ? [turns[turns.length - 1]!] : [];
      })()
    : [];
  const lastAssistantForReview = assistantTurnsForReview.length
    ? assistantTurnsForReview[assistantTurnsForReview.length - 1]
    : undefined;

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: apiMessages,
      model: deps.getSessions().find((s) => s.id === sessionId)?.model || deps.selectedModel,
      systemPrompt: deps.systemPrompt,
      referenceText: combinedReference,
      skills: deps.skillsPayloadForSession(sessionId),
      memories: deps.memoriesPayload(),
      memoriesEnabled: deps.memoriesEnabled ? deps.memoriesEnabled() !== false : true,
      conversationId: sessionId,
      integrations,
      enableSearch: requestOpts?.enableSearch !== false,
      autoReview:
        requestOpts?.autoReview ??
        deps.getSessions().find((s) => s.id === sessionId)?.autoReview ??
        true,
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

  if (response.headers.get('X-Google-Auth') === 'requested-but-unauthorized') {
    deps.onGoogleAuthRequired?.();
  }
  if (response.headers.get('X-Notion-Auth') === 'requested-but-unauthorized') {
    deps.onNotionAuthRequired?.();
  }
  if (response.headers.get('X-GitHub-Auth') === 'requested-but-unauthorized') {
    deps.onGitHubAuthRequired?.();
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason: string | null = null;
  let serverTruncated: boolean | null = null;
  let serverTruncationReason: string | undefined;
  let serverCode: string | undefined;
  let malformedSse = 0;
  let seamPending = Boolean(seamPrefix);
  let sawDone = false;
  const thinkParser = createThinkStreamParser();
  const toolStripper = createToolCallStripper();

  // Clean any leaked <think> / fake tool markup already in the bubble (history / Resume).
  const seededThink = extractThinkBlocks(initialContent);
  const seededContent = stripFakeToolMarkup(seededThink.content);
  let streamed = seededContent;
  /** Orphan `</think>` rewound bubble → Thought; do not promote that draft back. */
  let suppressedOrphanPromote = false;
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
    if (split.orphanClose) {
      // Content before the orphan </think> may already be in the bubble.
      deps.setSessions((prev) =>
        withRewoundAssistantContentToReasoning(prev, sessionId, assistantId),
      );
      streamed = '';
      suppressedOrphanPromote = true;
    }
    if (split.reasoning) {
      appendToAssistantReasoning(split.reasoning);
    }
    if (split.content) emitContent(split.content);
  };

  const settle = (unexpectedEnd = false) => {
    if (malformedSse > 0) {
      deps.onMalformedSse?.(
        malformedSse === 1
          ? 'Ignored 1 unreadable stream chunk.'
          : `Ignored ${malformedSse} unreadable stream chunks.`,
      );
    }

    deps.setSessions((prev) => withSettledOpenToolRuns(prev, sessionId, assistantId));

    const flushed = thinkParser.flush();
    if (flushed.orphanClose) {
      deps.setSessions((prev) =>
        withRewoundAssistantContentToReasoning(prev, sessionId, assistantId),
      );
      streamed = '';
      suppressedOrphanPromote = true;
    }
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
    // Skip when an orphan </think> already moved draft prose into Thought —
    // promoting would undo that separation.
    if (!streamed.trim()) {
      const live = deps
        .getSessions()
        .find((s) => s.id === sessionId)
        ?.messages.find((m) => m.id === assistantId);
      const reasoning = String(live?.reasoning || '').trim();
      const action = settleEmptyBodyAction({
        suppressedOrphanPromote,
        reasoning,
      });
      if (action === 'promote' && reasoning) {
        streamed = reasoning;
        deps.setSessions((prev) =>
          withPromotedOrphanReasoning(prev, sessionId, assistantId, reasoning),
        );
      } else if (action === 'thought_only') {
        // Keep Thought; do not return early — unexpectedEnd / onReplySettled below
        // must still run (orphan </think> with a dropped connection needs Continue).
      } else if (action === 'empty_error') {
        const fallback =
          'Error: The model returned an empty reply. Please try again, or switch to another model.';
        streamed = fallback;
        deps.setSessions((prev) =>
          withEmptyReplyFallback(prev, sessionId, assistantId, fallback),
        );
        markAssistantIncomplete(false, {
          finishReason: finishReason || 'error',
          truncationReason: actionFromStreamCode('empty_reply')?.reason,
        });
        return;
      }
    }

    // Mid-tool idle may emit tools_timeout (finish_reason=length) before a
    // successful final answer. If the stream then completed with a real body,
    // do not keep Continue sticky on that recoverable code.
    if (serverCode === 'tools_timeout' && !unexpectedEnd) {
      const body = streamed.trim();
      const natural =
        (finishReason && NATURAL_FINISH_REASONS.has(finishReason)) ||
        serverTruncated === false ||
        finishReason === 'length';
      if (
        natural &&
        body.length >= 40 &&
        !looksAbruptlyCutOff(streamed).truncated &&
        !structuralTruncation(
          streamed,
          finishReason === 'length' ? 'stop' : finishReason,
        ).truncated
      ) {
        serverCode = undefined;
        if (
          !serverTruncationReason ||
          serverTruncationReason === RECOVERABLE_TOOL_TIMEOUT_REASON ||
          serverTruncationReason.startsWith('Stream timed out during tool use')
        ) {
          serverTruncationReason = undefined;
        }
        if (serverTruncated === true) serverTruncated = false;
        if (finishReason === 'length') finishReason = 'stop';
      }
    }

    const fromCode = actionFromStreamCode(serverCode);

    // Connection dropped / function killed mid-stream: no [DONE] arrived.
    // Prefer Continue over silently treating the partial reply as finished.
    if (unexpectedEnd && !finishReason && serverTruncated == null && !fromCode) {
      markAssistantIncomplete(true, {
        finishReason,
        truncationReason:
          malformedSse > 0
            ? 'Stream ended with unreadable chunks'
            : 'Stream ended unexpectedly',
      });
      return;
    }

    if (fromCode?.preferRetry) {
      markAssistantIncomplete(false, {
        finishReason: finishReason || 'error',
        truncationReason: fromCode.reason,
      });
      return;
    }

    const verdict = analyzeTruncation(
      streamed,
      finishReason,
      unexpectedEnd || thinkParser.inThink,
      undefined,
      {
        serverTruncated: fromCode ? fromCode.truncated : serverTruncated,
        serverReason: fromCode?.reason || serverTruncationReason,
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
        return streamed;
      }
      try {
        const parsed = JSON.parse(data);
        if (parsed.finish_reason) {
          finishReason = parsed.finish_reason;
          // A later natural stop must clear sticky mid-stream tools_timeout
          // even if that event omitted truncated:false.
          if (
            NATURAL_FINISH_REASONS.has(String(parsed.finish_reason)) &&
            serverCode === 'tools_timeout'
          ) {
            serverCode = undefined;
            if (
              !serverTruncationReason ||
              serverTruncationReason === RECOVERABLE_TOOL_TIMEOUT_REASON ||
              serverTruncationReason.startsWith('Stream timed out during tool use')
            ) {
              serverTruncationReason = undefined;
            }
            if (serverTruncated === true) serverTruncated = false;
          }
        }
        if (typeof parsed.truncated === 'boolean') {
          serverTruncated = parsed.truncated;
          // A later natural completion must clear sticky mid-stream codes
          // (e.g. tools_timeout sent before a successful final answer).
          if (parsed.truncated === false) {
            serverCode = undefined;
            if (!parsed.truncation_reason) serverTruncationReason = undefined;
          }
        }
        if (typeof parsed.truncation_reason === 'string' && parsed.truncation_reason) {
          serverTruncationReason = parsed.truncation_reason;
        }
        if (typeof parsed.code === 'string' && parsed.code) {
          // Do not re-stick tools_timeout after a later natural completion.
          if (
            parsed.code === 'tools_timeout' &&
            (serverTruncated === false ||
              (finishReason && NATURAL_FINISH_REASONS.has(finishReason)))
          ) {
            /* ignore stale / out-of-order idle signal */
          } else {
            serverCode = parsed.code;
          }
        }
        const usage = readCompletionUsage(parsed);
        if (usage) deps.onCompletionUsage?.(usage);
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
          const toolStatusRaw = String(parsed.tool.status || 'start');
          const toolStatus =
            toolStatusRaw === 'done'
              ? 'done'
              : toolStatusRaw === 'awaiting_approval'
                ? 'awaiting_approval'
                : 'start';
          deps.setSessions((prev) => {
            const result = withUpsertedAssistantToolRun(prev, sessionId, assistantId, {
              name: String(parsed.tool.name || 'web_search'),
              status: toolStatus,
              query: parsed.tool.query,
              callId:
                typeof parsed.tool.callId === 'string'
                  ? parsed.tool.callId
                  : typeof parsed.tool.call_id === 'string'
                    ? parsed.tool.call_id
                    : undefined,
              provider: parsed.tool.provider,
              results: Array.isArray(parsed.tool.results) ? parsed.tool.results : undefined,
              error: parsed.tool.error,
              approval:
                parsed.tool.approval && typeof parsed.tool.approval === 'object'
                  ? (parsed.tool.approval as import('@/lib/mcp/google/gmail-approval').GmailApprovalDraft)
                  : undefined,
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
        if (parsed.image_generated && typeof parsed.image_generated === 'object') {
          const raw = parsed.image_generated as Record<string, unknown>;
          const imageUrl = String(raw.url || '');
          const prompt = String(raw.prompt || '');
          const fileId = raw.fileId ? String(raw.fileId) : undefined;
          if (imageUrl) {
            deps.setSessions((prev) =>
              prev.map((s) => {
                if (s.id !== sessionId) return s;
                return {
                  ...s,
                  messages: s.messages.map((m) => {
                    if (m.id !== assistantId) return m;
                    return {
                      ...m,
                      content: m.content || '',
                      images: [
                        ...(m.images || []),
                        {
                          url: imageUrl,
                          name: 'generated.png',
                          prompt,
                          model: String(raw.model || 'GPT Image 1.5'),
                          fileId,
                        },
                      ],
                    };
                  }),
                  updatedAt: Date.now(),
                };
              }),
            );
            if (sessionId === deps.getActiveSessionId()) {
              deps.onGeneratedFileForActiveSession();
            }
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
        if (parsed.view_created && typeof parsed.view_created === 'object') {
          const raw = parsed.view_created as Record<string, unknown>;
          const view: ToolViewInput = {
            id: String(raw.id || ''),
            viewType: String(raw.viewType || ''),
            title: String(raw.title || ''),
            sourceFileId:
              typeof raw.sourceFileId === 'string' ? raw.sourceFileId : undefined,
            sourceFileName:
              typeof raw.sourceFileName === 'string' ? raw.sourceFileName : undefined,
            createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
            data: raw.data,
          };
          deps.setSessions((prev) =>
            withAppendedAssistantToolView(prev, sessionId, assistantId, view),
          );
          if (sessionId === deps.getActiveSessionId()) {
            deps.onGeneratedFileForActiveSession();
            deps.onViewCreatedForActiveSession?.(view);
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
        // Keep streaming; surface a count via onMalformedSse at settle.
        malformedSse += 1;
      }
    }
  }

  settle(!sawDone);
  return streamed;
}
