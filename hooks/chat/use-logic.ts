/**
 * Send / queue / image-gen / resume / claim-review / edit-retry for the active chat.
 *
 *  Queue state:     hooks/chat/use-chat-queue.ts
 *  Queue helpers:   lib/chat/turn/task-queue.ts
 *  Continue/review: lib/chat/turn/continuation.ts
 *  Attachments:     lib/chat/turn/attachments.ts
 *  Send estimate:   lib/chat/turn/send-estimate.ts
 *  Stream errors:   lib/chat/turn/stream-error.ts
 *  Image gen:       lib/chat/turn/image-generation.ts
 *  Literature:      lib/chat/turn/literature-command.ts, literature-search.ts
 *  Account:         hooks/chat/use-account.ts
 *  Integrations:    hooks/chat/use-integrations.ts
 *  Persist:         hooks/chat/use-session-persist.ts
 *  SSE parse:       lib/chat/stream/client.ts
 */
import { useEffect, useState } from 'react';
import type { Message, ChatSession } from '@/lib/chat/types';
import type { IngestedAttachment } from '@/lib/files/ingest';
import { parseImageCommand } from '@/lib/chat/turn/image-command';
import { parseLiteratureCommand } from '@/lib/chat/turn/literature-command';
import { parseSkillCommand } from '@/lib/chat/turn/skill-command';
import { SKILL_CREATOR_ID } from '@/lib/skills/creator';
import { useLocale } from '@/lib/i18n';
import { formatQuotedMessage } from '@/lib/chat/message/quotes';
import { toApiMessages, ingestedToMessageImages } from '@/lib/chat/message/api-messages';
import { isImageAttachment } from '@/components/files/AttachmentImageThumb';
import { stripUserMessageArtifactsForDisplay } from '@/lib/tools/image-understand/persist';
import { isAssistantError } from '@/lib/chat/message/display';
import { compactConversationHistory } from '@/lib/chat/turn/compact';
import {
  clearPauseForSession,
  pauseSession,
  removeTaskById,
  removeTasksById,
  removeTasksForSession,
  requeueFailedTask,
  selectTasksToDrain,
  type QueuedTask,
} from '@/lib/chat/turn/task-queue';
import { useChatQueue } from '@/hooks/chat/use-chat-queue';
import {
  buildClaimReviewUserPrompt,
  buildResumeStreamPlan,
  clearedEmptyAssistant,
  gateResumeIncompleteReply,
} from '@/lib/chat/turn/continuation';
import {
  cleanBaseMessagesForSend,
  messageImagesFromAttachments,
  resolvePendingAttachments,
  titleForNewConversation,
} from '@/lib/chat/turn/attachments';
import { collapseAttachedFileBodiesInMessages } from '@/lib/files/attached-file-blocks';
import { webSourcesForThread } from '@/lib/chat/context/references';
import {
  estimateTokensForSend,
  exceedsUsableWindow,
  shouldCompactBeforeSend,
} from '@/lib/chat/turn/send-estimate';
import {
  applyAssistantStreamFailure,
  applyGeneratedImageToAssistant,
  applyImageGenerationError,
  isAbortError,
  mapAssistantById,
} from '@/lib/chat/turn/stream-error';
import {
  buildImageGenerationThread,
  requestImageGeneration,
} from '@/lib/chat/turn/image-generation';
import {
  buildLiteratureSearchThread,
  formatLiteratureMarkdown,
  literatureToolRun,
  requestBookDownload,
  requestLiteratureSearch,
} from '@/lib/chat/turn/literature-search';
import {
  bookDownloadToolRun,
  buildBookDownloadThread,
  formatBookDownloadMarkdown,
  mimeForDownloadedBook,
} from '@/lib/chat/turn/book-download-turn';

export type { QueuedTask };
export type UseChatLogicProps = {
  activeSessionId: string;
  sessionsRef: React.MutableRefObject<ChatSession[]>;
  activeSessionIdRef: React.MutableRefObject<string>;
  abortControllersRef: React.MutableRefObject<Map<string, AbortController>>;
  updateSession: (sessionId: string, messages: Message[], title?: string) => void;
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  markAssistantIncomplete: (sessionId: string, assistantId: string, incomplete: boolean, meta?: { finishReason?: string | null; truncationReason?: string }) => void;
  streamChatResponse: (
    sessionId: string,
    apiMessages: any,
    assistantId: string,
    signal: AbortSignal,
    initialContent?: string,
    seamPrefix?: string,
    webSourcesOverride?: any[],
    requestReview?: boolean,
    requestOpts?: {
      enableSearch?: boolean;
      integrations?: string[];
      autoReview?: boolean;
    },
  ) => Promise<string | void>;
  
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  quotedSelections: string[];
  setQuotedSelections: React.Dispatch<React.SetStateAction<string[]>>;
  attachments: IngestedAttachment[];
  setAttachments: React.Dispatch<React.SetStateAction<IngestedAttachment[]>>;
  setAttachError: React.Dispatch<React.SetStateAction<string>>;
  
  isAccountBound: boolean;
  openLoginModal: () => void;
  
  stickToBottomRef: React.MutableRefObject<boolean>;
  scrollToBottom: (force?: boolean) => void;
  setIsSkillPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  
  selectedSpec: { vision: boolean; context: number | null; maxOutput: number | null };
  selectedModel: string;
  zhipuVisionOn: boolean;
  usableLimit: number | null;
  contextBreakdown: { system: number; skills: number };
  
  setPicturesExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setOutputGroupsOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setIsContextPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  
  editingMessageContent: string;
  setEditingMessageContent: React.Dispatch<React.SetStateAction<string>>;
  editingMessageAttachments: IngestedAttachment[];
  setEditingMessageAttachments: React.Dispatch<React.SetStateAction<IngestedAttachment[]>>;
  setEditingMessageId: React.Dispatch<React.SetStateAction<string | null>>;
  
  messages: Message[];
  messageImagesToIngested: (images: Message['images']) => IngestedAttachment[];
};

export function useChatLogic(props: UseChatLogicProps) {
  const { t } = useLocale();
  const {
    activeSessionId, sessionsRef, activeSessionIdRef, abortControllersRef,
    updateSession, setSessions, markAssistantIncomplete, streamChatResponse,
    input, setInput, quotedSelections, setQuotedSelections, attachments, setAttachments, setAttachError,
    isAccountBound, openLoginModal, stickToBottomRef, scrollToBottom, setIsSkillPickerOpen,
    selectedSpec, selectedModel, zhipuVisionOn, usableLimit, contextBreakdown,
    setPicturesExpanded, setOutputGroupsOpen, setIsContextPanelOpen,
    editingMessageContent, setEditingMessageContent, editingMessageAttachments, setEditingMessageAttachments, setEditingMessageId,
    messages, messageImagesToIngested
  } = props;

  const [loadingBySession, setLoadingBySession] = useState<Record<string, boolean>>({});
  const {
    messageQueue,
    setMessageQueue,
    queuePausedBySession,
    setQueuePausedBySession,
    activeQueue,
    queuePaused,
    cancelQueuedMessage,
    clearQueue,
    resumeQueue,
  } = useChatQueue(activeSessionId);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactNotice, setCompactNotice] = useState('');

  const beginLoading = (sessionId: string) => {
    setLoadingBySession((prev) => ({ ...prev, [sessionId]: true }));
  };
  const endLoading = (sessionId: string) => {
    setLoadingBySession((prev) => {
      if (!prev[sessionId]) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    abortControllersRef.current.delete(sessionId);
  };
  const endLoadingIfController = (sessionId: string, controller: AbortController) => {
    if (abortControllersRef.current.get(sessionId) !== controller) return;
    endLoading(sessionId);
  };
  
  const failAssistantStream = (
    sessionId: string,
    assistantId: string,
    error: unknown,
    abortReason: string,
    opts?: { keep?: 'content' | 'content_or_reasoning' },
  ) => {
    if (isAbortError(error)) {
      markAssistantIncomplete(sessionId, assistantId, true, {
        truncationReason: abortReason,
      });
      return;
    }
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        return {
          ...s,
          messages: applyAssistantStreamFailure(s.messages, assistantId, error, {
            keep: opts?.keep,
          }),
          updatedAt: Date.now(),
        };
      }),
    );
  };

  const isSessionLoading = (sessionId: string) => Boolean(loadingBySession[sessionId]);
  const isActiveLoading = isSessionLoading(activeSessionId);


  // Drain each session's queue only when that session is idle and not paused.
  useEffect(() => {
    const toStart = selectTasksToDrain(messageQueue, loadingBySession, queuePausedBySession);
    if (toStart.length === 0) return;
    const ids = new Set(toStart.map((task) => task.id));
    setMessageQueue((prev) => removeTasksById(prev, ids));
    for (const task of toStart) {
      // Reserve the session slot immediately so another drain can't double-start
      // while handleSubmit awaits compact / network.
      beginLoading(task.sessionId);
      void (async () => {
        const ok = await handleSubmit(task.content, task.baseMessages, false, task.sessionId, {
          alreadyLoading: true,
        });
        if (!ok) {
          endLoading(task.sessionId);
          setMessageQueue((prev) => [...prev, requeueFailedTask(task)]);
        }
      })();
    }
  }, [messageQueue, loadingBySession, queuePausedBySession]);

  const enqueueOrSubmit = (overrideInput?: string, baseMessagesOverride?: Message[]) => {
    const fromComposer = overrideInput == null;
    const raw = overrideInput ?? input;
    const skillRequest = parseSkillCommand(raw);
    if (skillRequest !== null) {
      if (!isAccountBound) {
        openLoginModal();
        return;
      }
      setSessions((prev) => {
        const next = prev.map((session) =>
          session.id === activeSessionId
            ? {
                ...session,
                skillIds: (session.skillIds || []).includes(SKILL_CREATOR_ID)
                  ? session.skillIds
                  : [...(session.skillIds || []), SKILL_CREATOR_ID],
                updatedAt: Date.now(),
              }
            : session,
        );
        // handleSubmit reads this ref immediately after command parsing.
        sessionsRef.current = next;
        return next;
      });
    }
    const commandText =
      skillRequest !== null
        ? skillRequest || '请开始创建一个新的 Skill。先简洁询问我用途、触发场景、约束和期望输出格式。'
        : raw;
    const quotes = fromComposer ? quotedSelections : [];
    const textToSend = formatQuotedMessage(commandText, quotes);
    const hasPending = fromComposer && attachments.length > 0;
    if (!textToSend.trim() && !hasPending) return;
    const sessionId = activeSessionId;

    if (isSessionLoading(sessionId)) {
      if (!textToSend.trim()) return;
      // Interrupt the in-flight reply — including auto-review / correction —
      // so a new message does not wait for the audit to finish.
      stopGenerating({ pauseQueue: false, sessionId });
      if (fromComposer) {
        setInput('');
        setQuotedSelections([]);
      }
      const snapshot =
        baseMessagesOverride ??
        sessionsRef.current.find((s) => s.id === sessionId)?.messages;
      window.setTimeout(() => {
        void handleSubmit(textToSend.trim(), snapshot, false, sessionId);
      }, 50);
      return;
    }

    if (fromComposer) {
      setInput('');
      setQuotedSelections([]);
    }
    beginLoading(sessionId);
    void handleSubmit(textToSend, baseMessagesOverride, false, sessionId, {
      alreadyLoading: true,
    }).then((ok) => {
      if (!ok) endLoading(sessionId);
    });
  };



  const jumpQueueAndSubmit = (id: string) => {
    const task = messageQueue.find((item) => item.id === id);
    if (!task) return;
    setMessageQueue((prev) => removeTaskById(prev, id));
    // Send Now — abort that session's current reply without freezing the rest.
    if (isSessionLoading(task.sessionId)) {
      stopGenerating({ pauseQueue: false, sessionId: task.sessionId });
    }
    setQueuePausedBySession((prev) => clearPauseForSession(prev, task.sessionId));
    setTimeout(() => {
      handleSubmit(task.content, task.baseMessages, true, task.sessionId);
    }, 50);
  };

  const runCompact = async (history: Message[]): Promise<Message[] | null> => {
    setIsCompacting(true);
    setCompactNotice('Compacting earlier conversation…');
    try {
      const result = await compactConversationHistory({
        history,
        model: selectedModel,
        vision: selectedSpec.vision,
      });
      setCompactNotice(result.notice);
      if (result.messages) window.setTimeout(() => setCompactNotice(''), 4000);
      return result.messages;
    } finally {
      setIsCompacting(false);
    }
  };

  const generateImage = async (
    prompt: string,
    opts?: {
      baseMessages?: Message[];
      skipDuplicateUser?: boolean;
      sessionId?: string;
      /** Caller already called beginLoading (e.g. queue drain). */
      alreadyLoading?: boolean;
    },
  ): Promise<boolean> => {
    const trimmed = prompt.trim();
    if (!trimmed) return false;
    if (!isAccountBound) {
      openLoginModal();
      return false;
    }
    const sessionId = opts?.sessionId || activeSessionId;
    if (isSessionLoading(sessionId) && !opts?.alreadyLoading) return false;

    stickToBottomRef.current = true;
    if (sessionId === activeSessionId) scrollToBottom(true);
    setIsSkillPickerOpen(false);
    if (sessionId === activeSessionId) setInput('');
    if (!opts?.alreadyLoading) beginLoading(sessionId);

    const sessionMessages =
      opts?.baseMessages ??
      sessionsRef.current.find((s) => s.id === sessionId)?.messages ??
      [];
    const cleanedBase = cleanBaseMessagesForSend(sessionMessages);
    const { thread, assistantId, toolRunId, newTitle } = buildImageGenerationThread({
      prompt: trimmed,
      cleanedBase,
      skipDuplicateUser: opts?.skipDuplicateUser,
      currentTitle: sessionsRef.current.find((s) => s.id === sessionId)?.title,
    });
    updateSession(sessionId, thread, newTitle);

    try {
      const result = await requestImageGeneration({ prompt: trimmed });
      if (!result.ok) throw new Error(result.error);

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            messages: mapAssistantById(s.messages, assistantId, (m) => {
              const patched = applyGeneratedImageToAssistant(m, {
                imageUrl: result.image,
                prompt: trimmed,
                fileId: result.fileId,
              });
              return {
                ...patched,
                toolRuns: (m.toolRuns || []).map((r) =>
                  r.id === toolRunId
                    ? {
                        ...r,
                        status: 'done' as const,
                        provider: 'gpt-image',
                        results: [
                          {
                            title: trimmed.slice(0, 80),
                            url: result.image,
                            snippet: result.fileId ? `file ${result.fileId}` : '',
                          },
                        ],
                      }
                    : r,
                ),
              };
            }),
            updatedAt: Date.now(),
          };
        }),
      );
      if (sessionId === activeSessionIdRef.current) {
        setPicturesExpanded(true);
        setOutputGroupsOpen((prev) => ({ ...prev, images: true }));
        setIsContextPanelOpen(true);
      }
    } catch (error: any) {
      const errMsg = error?.message || 'Image generation failed';
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            messages: mapAssistantById(s.messages, assistantId, (m) => {
              const patched = applyImageGenerationError(m, errMsg);
              return {
                ...patched,
                toolRuns: (m.toolRuns || []).map((r) =>
                  r.id === toolRunId
                    ? { ...r, status: 'done' as const, error: errMsg }
                    : r,
                ),
              };
            }),
            updatedAt: Date.now(),
          };
        }),
      );
    } finally {
      endLoading(sessionId);
    }
    return true;
  };

  const runBookDownload = async (
    identifier: string,
    opts?: {
      baseMessages?: Message[];
      skipDuplicateUser?: boolean;
      sessionId?: string;
      alreadyLoading?: boolean;
    },
  ): Promise<boolean> => {
    const id = identifier.trim();
    if (!id) return false;
    if (!isAccountBound) {
      openLoginModal();
      return false;
    }
    const sessionId = opts?.sessionId || activeSessionId;
    if (isSessionLoading(sessionId) && !opts?.alreadyLoading) return false;

    stickToBottomRef.current = true;
    if (sessionId === activeSessionId) scrollToBottom(true);
    setIsSkillPickerOpen(false);
    if (sessionId === activeSessionId) setInput('');
    if (!opts?.alreadyLoading) beginLoading(sessionId);

    const sessionMessages =
      opts?.baseMessages ??
      sessionsRef.current.find((s) => s.id === sessionId)?.messages ??
      [];
    const cleanedBase = cleanBaseMessagesForSend(sessionMessages);
    const { thread, assistantId, toolRunId, newTitle } = buildBookDownloadThread({
      identifier: id,
      cleanedBase,
      skipDuplicateUser: opts?.skipDuplicateUser,
      currentTitle: sessionsRef.current.find((s) => s.id === sessionId)?.title,
    });
    updateSession(sessionId, thread, newTitle);

    try {
      const result = await requestBookDownload(id);
      if (!result.ok) throw new Error(result.error);
      const content = formatBookDownloadMarkdown(result);
      const doneRun = bookDownloadToolRun({
        identifier: result.identifier,
        title: result.title,
        filename: result.filename,
        sourceUrl: result.sourceUrl,
        fileId: result.fileId,
        provider: result.provider,
      });
      const fileEntry = {
        id: result.fileId,
        name: result.filename || result.title || 'book',
        mimeType: mimeForDownloadedBook(result.filename || ''),
        size: result.bytes || 0,
        url: `/api/files/${encodeURIComponent(result.fileId)}`,
        createdAt: Date.now(),
      };
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            messages: mapAssistantById(s.messages, assistantId, (m) => {
              const activity = [
                ...(m.activity || []),
                { id: crypto.randomUUID(), kind: 'file' as const, fileId: result.fileId },
              ];
              if (content.trim()) {
                activity.push({
                  id: crypto.randomUUID(),
                  kind: 'content' as const,
                  text: content,
                });
              }
              return {
                ...m,
                content,
                incomplete: false,
                files: [...(m.files || []).filter((f) => f.id !== fileEntry.id), fileEntry],
                toolRuns: (m.toolRuns || []).map((r) =>
                  r.id === toolRunId
                    ? {
                        ...r,
                        status: 'done' as const,
                        provider: doneRun.provider,
                        results: doneRun.results,
                      }
                    : r,
                ),
                activity,
              };
            }),
            updatedAt: Date.now(),
          };
        }),
      );
      if (sessionId === activeSessionIdRef.current) {
        setOutputGroupsOpen((prev) => ({ ...prev, files: true }));
        setIsContextPanelOpen(true);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Book download failed';
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            messages: mapAssistantById(s.messages, assistantId, (m) => ({
              ...m,
              content: `Error: ${message}`,
              incomplete: false,
              toolRuns: (m.toolRuns || []).map((r) =>
                r.id === toolRunId
                  ? { ...r, status: 'done' as const, error: message }
                  : r,
              ),
            })),
            updatedAt: Date.now(),
          };
        }),
      );
    } finally {
      endLoading(sessionId);
    }
    return true;
  };

  const runLiteratureSearch = async (
    kind: 'papers' | 'books',
    query: string,
    opts?: {
      baseMessages?: Message[];
      skipDuplicateUser?: boolean;
      sessionId?: string;
      alreadyLoading?: boolean;
      source?: string;
      action?: 'search' | 'details' | 'citations' | 'references' | 'author';
      paperId?: string;
    },
  ): Promise<boolean> => {
    const trimmed = query.trim();
    if (!trimmed) return false;
    if (!isAccountBound) {
      openLoginModal();
      return false;
    }
    const sessionId = opts?.sessionId || activeSessionId;
    if (isSessionLoading(sessionId) && !opts?.alreadyLoading) return false;

    stickToBottomRef.current = true;
    if (sessionId === activeSessionId) scrollToBottom(true);
    setIsSkillPickerOpen(false);
    if (sessionId === activeSessionId) setInput('');
    if (!opts?.alreadyLoading) beginLoading(sessionId);

    const sessionMessages =
      opts?.baseMessages ??
      sessionsRef.current.find((s) => s.id === sessionId)?.messages ??
      [];
    const cleanedBase = cleanBaseMessagesForSend(sessionMessages);
    const { thread, assistantId, toolRunId, newTitle } = buildLiteratureSearchThread({
      kind,
      query: trimmed,
      cleanedBase,
      skipDuplicateUser: opts?.skipDuplicateUser,
      currentTitle: sessionsRef.current.find((s) => s.id === sessionId)?.title,
      source: opts?.source,
      action: opts?.action,
    });
    updateSession(sessionId, thread, newTitle);

    try {
      const result = await requestLiteratureSearch(kind, trimmed, {
        source: opts?.source,
        action: opts?.action,
        paperId: opts?.paperId,
      });
      if (!result.ok) throw new Error(result.error);
      const content = formatLiteratureMarkdown(
        kind,
        result.query,
        result.provider,
        result.results,
        { authors: result.authors, action: opts?.action },
      );
      const doneRun = literatureToolRun(
        kind,
        result.query,
        result.provider,
        result.results,
      );
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            messages: mapAssistantById(s.messages, assistantId, (m) => ({
              ...m,
              content,
              incomplete: false,
              toolRuns: (m.toolRuns || []).map((r) =>
                r.id === toolRunId
                  ? {
                      ...r,
                      status: 'done' as const,
                      provider: doneRun.provider,
                      results: doneRun.results,
                    }
                  : r,
              ),
              activity: [
                ...(m.activity || []),
                { id: crypto.randomUUID(), kind: 'content', text: content },
              ],
            })),
            updatedAt: Date.now(),
          };
        }),
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Literature search failed';
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            messages: mapAssistantById(s.messages, assistantId, (m) => ({
              ...m,
              content: `Error: ${message}`,
              incomplete: false,
              toolRuns: (m.toolRuns || []).map((r) =>
                r.id === toolRunId
                  ? { ...r, status: 'done' as const, error: message }
                  : r,
              ),
            })),
            updatedAt: Date.now(),
          };
        }),
      );
    } finally {
      endLoading(sessionId);
    }
    return true;
  };

  const handleSubmit = async (
    overrideInput?: string,
    baseMessagesOverride?: Message[],
    force: boolean = false,
    targetSessionId?: string,
    opts?: {
      alreadyLoading?: boolean;
      resendAttachments?: IngestedAttachment[];
    },
  ): Promise<boolean> => {
    const sessionId = targetSessionId || activeSessionId;
    const textToSend = overrideInput || (sessionId === activeSessionId ? input : '');
    const imagePrompt = parseImageCommand(textToSend);
    if (imagePrompt) {
      if (!force && isSessionLoading(sessionId) && !opts?.alreadyLoading) return false;
      return generateImage(imagePrompt, {
        sessionId,
        alreadyLoading: opts?.alreadyLoading,
        baseMessages: baseMessagesOverride,
      });
    }

    const literatureCmd = parseLiteratureCommand(textToSend);
    if (literatureCmd) {
      if (!force && isSessionLoading(sessionId) && !opts?.alreadyLoading) return false;
      if (literatureCmd.action === 'download') {
        if (literatureCmd.error) {
          setAttachError(
            literatureCmd.error === 'missing_identifier'
              ? t('booksDownloadMissingId')
              : t('booksDownloadInvalidId'),
          );
          return false;
        }
        return runBookDownload(literatureCmd.identifier, {
          sessionId,
          alreadyLoading: opts?.alreadyLoading,
          baseMessages: baseMessagesOverride,
        });
      }
      return runLiteratureSearch(literatureCmd.kind, literatureCmd.query, {
        sessionId,
        alreadyLoading: opts?.alreadyLoading,
        baseMessages: baseMessagesOverride,
        source: 'source' in literatureCmd ? literatureCmd.source : undefined,
        action: literatureCmd.action || 'search',
        paperId:
          literatureCmd.kind === 'papers' && 'paperId' in literatureCmd
            ? literatureCmd.paperId
            : undefined,
      });
    }

    const resolved = resolvePendingAttachments({
      textToSend,
      attachments,
      resendAttachments: opts?.resendAttachments,
      baseMessagesOverride,
      isActiveSession: sessionId === activeSessionId,
      vision: selectedSpec.vision,
      zhipuVisionOn,
      isLoading: isSessionLoading(sessionId),
      force,
      alreadyLoading: opts?.alreadyLoading,
    });
    if (!resolved.ok) {
      if (resolved.error === 'images_need_vision' && sessionId === activeSessionId) {
        setAttachError(t('imagesNeedVision'));
      } else if (resolved.error === 'upload_in_progress') {
        setAttachError('Wait for image upload to finish');
      } else if (resolved.error === 'upload_failed') {
        setAttachError('Remove or re-add images that failed to upload');
      }
      return false;
    }
    const { pendingImages, fullContent } = resolved;

    if (sessionId === activeSessionId) {
      stickToBottomRef.current = true;
      scrollToBottom(true);
    }

    const sessionMessages =
      baseMessagesOverride ??
      sessionsRef.current.find((s) => s.id === sessionId)?.messages ??
      [];
    // Persist older turns as refs only (sidecar + file_read). Latest user message
    // below still carries full extract so Retry / first answer stay intact.
    let baseMessages = collapseAttachedFileBodiesInMessages(
      cleanBaseMessagesForSend(sessionMessages),
      { onlyWithFileId: true },
    );
    let newTitle = sessionsRef.current.find((s) => s.id === sessionId)?.title;
    if (baseMessages.length === 0) {
      newTitle = titleForNewConversation(textToSend, pendingImages);
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: fullContent || (pendingImages.length ? '(image)' : ''),
      timestamp: Date.now(),
      images: messageImagesFromAttachments(pendingImages),
    };

    const historySnapshot = sessionsRef.current.find((s) => s.id === sessionId);

    let newMessages = [...baseMessages, userMessage];
    updateSession(sessionId, newMessages, newTitle);
    if (sessionId === activeSessionId) {
      setInput('');
      attachments.forEach((a) => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      });
      setAttachments([]);
    }

    if (!opts?.alreadyLoading) beginLoading(sessionId);

    const projectTokens = (history: Message[]) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      return estimateTokensForSend({
        history,
        nextUserText: fullContent,
        pendingImageCount: pendingImages.length,
        // Match the sources we will actually send (thread-derived), not a stale
        // session.webSources left over from turns truncated by edit/resend.
        webSources: webSourcesForThread([...history, userMessage], session),
        contextBreakdown,
      });
    };

    const restoreHistoryIfNeeded = () => {
      if (!historySnapshot || !baseMessagesOverride) return;
      updateSession(sessionId, historySnapshot.messages, historySnapshot.title);
    };

    if (usableLimit != null) {
      let projected = projectTokens(baseMessages);
      if (shouldCompactBeforeSend(projected, usableLimit)) {
        const compacted = await runCompact(baseMessages);
        if (!compacted) {
          restoreHistoryIfNeeded();
          setAttachError('Context is full. Compact failed — open a new chat or remove attachments.');
          if (!opts?.alreadyLoading) endLoading(sessionId);
          return false;
        }
        baseMessages = compacted;
        newMessages = [...baseMessages, userMessage];
        updateSession(sessionId, newMessages, newTitle);
        projected = projectTokens(baseMessages);
        if (exceedsUsableWindow(projected, usableLimit)) {
          restoreHistoryIfNeeded();
          setAttachError(
            `Context (~${projected.toLocaleString()}) exceeds this model's usable window (${usableLimit.toLocaleString()}). Remove attachments, compact, or switch to a larger-window model.`,
          );
          if (!opts?.alreadyLoading) endLoading(sessionId);
          return false;
        }
      }
    }

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      incomplete: true,
    };
    updateSession(sessionId, [...newMessages, assistantMessage], newTitle);

    const controller = new AbortController();
    abortControllersRef.current.set(sessionId, controller);
    const sessionAfterTruncate = sessionsRef.current.find((s) => s.id === sessionId);
    // Always derive Material from the messages in this request. Reading
    // session.webSources here used to re-attach pre-edit search hits after
    // Save & resend truncated the visible thread.
    const threadSources = webSourcesForThread(
      [...newMessages, assistantMessage],
      sessionAfterTruncate,
    );

    try {
      await streamChatResponse(
        sessionId,
        toApiMessages(newMessages, { vision: selectedSpec.vision }),
        assistantMessage.id,
        controller.signal,
        '',
        '',
        threadSources,
      );
    } catch (error: any) {
      failAssistantStream(sessionId, assistantMessage.id, error, 'Reply was interrupted');
    } finally {
      endLoadingIfController(sessionId, controller);
    }
    return true;
  };

  const resumeIncompleteReply = async (opts?: { force?: boolean }) => {
    const sessionId = activeSessionIdRef.current;
    const sessionMessages = sessionsRef.current.find((s) => s.id === sessionId)?.messages || [];
    const last = sessionMessages[sessionMessages.length - 1];
    const gate = gateResumeIncompleteReply(last, {
      force: opts?.force,
      isLoading: isSessionLoading(sessionId),
    });
    if (!gate.ok || !last) return;
    const { emptyInterrupted } = gate;

    stickToBottomRef.current = true;
    scrollToBottom(true);
    beginLoading(sessionId);

    const controller = new AbortController();
    abortControllersRef.current.set(sessionId, controller);

    const lastUser = [...sessionMessages].reverse().find((m) => m.role === 'user');
    const plan = buildResumeStreamPlan({ last, lastUser, emptyInterrupted });

    if (plan.kind === 'reanswer_empty') {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            updatedAt: Date.now(),
            messages: s.messages.map((m) =>
              m.id === last.id ? clearedEmptyAssistant(m) : m,
            ),
          };
        }),
      );
      try {
        await streamChatResponse(
          sessionId,
          toApiMessages(
            sessionMessages.filter((m) => m.id !== last.id),
            { vision: selectedSpec.vision },
          ),
          last.id,
          controller.signal,
          plan.initialContent,
          plan.seamPrefix,
          sessionsRef.current.find((s) => s.id === sessionId)?.webSources || [],
        );
      } catch (error: any) {
        failAssistantStream(sessionId, last.id, error, 'Reply was interrupted');
      } finally {
        endLoadingIfController(sessionId, controller);
      }
      return;
    }

    const apiMessages: ReturnType<typeof toApiMessages> = [
      ...toApiMessages(sessionMessages, { vision: selectedSpec.vision }),
      {
        role: 'user' as const,
        content: plan.extraUserContent,
        images: [],
        timestamp: Date.now(),
      },
    ];

    try {
      await streamChatResponse(
        sessionId,
        apiMessages,
        last.id,
        controller.signal,
        plan.initialContent,
        plan.seamPrefix,
      );
    } catch (error: any) {
      failAssistantStream(
        sessionId,
        last.id,
        error,
        plan.kind === 'continue' ? 'Stopped by you' : 'Reply was interrupted',
        plan.kind === 'continue' ? { keep: 'content' } : undefined,
      );
    } finally {
      endLoadingIfController(sessionId, controller);
    }
  };

  /** Request review — built-in action like Continue: audits the last assistant
   *  reply against tool receipts, no visible user command. */
  const requestClaimReview = async (opts?: {
    focus?: string;
    /** Visible user bubble text (defaults to `/review` + focus). */
    userContent?: string;
  }) => {
    const sessionId = activeSessionIdRef.current;
    if (!isAccountBound) {
      openLoginModal();
      return;
    }
    const sessionMessages = sessionsRef.current.find((s) => s.id === sessionId)?.messages || [];
    const lastAssistant = [...sessionMessages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant || isSessionLoading(sessionId)) return;

    const focus = String(opts?.focus || '').trim();
    const userContent =
      String(opts?.userContent || '').trim() ||
      (focus ? `/review ${focus}` : '/review');

    stickToBottomRef.current = true;
    scrollToBottom(true);
    beginLoading(sessionId);

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userContent,
      timestamp: Date.now(),
    };
    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      incomplete: true,
    };
    updateSession(sessionId, [...sessionMessages, userMessage, assistantMessage]);
    if (sessionId === activeSessionId) {
      setInput('');
    }

    const apiMessages: ReturnType<typeof toApiMessages> = [
      ...toApiMessages(sessionMessages, { vision: selectedSpec.vision }),
      {
        role: 'user' as const,
        content: buildClaimReviewUserPrompt(focus),
        images: [],
        timestamp: Date.now(),
      },
    ];

    const controller = new AbortController();
    abortControllersRef.current.set(sessionId, controller);
    try {
      await streamChatResponse(
        sessionId,
        apiMessages,
        assistantMessage.id,
        controller.signal,
        '',
        '',
        undefined,
        true,
      );
    } catch (error: any) {
      failAssistantStream(sessionId, assistantMessage.id, error, 'Stopped by you');
    } finally {
      endLoadingIfController(sessionId, controller);
    }
  };

  /** Drop the Error: assistant bubble and re-run the same user turn. */
  const retryFailedReply = async () => {
    const sessionId = activeSessionIdRef.current;
    const sessionMessages = sessionsRef.current.find((s) => s.id === sessionId)?.messages || [];
    const last = sessionMessages[sessionMessages.length - 1];
    if (isSessionLoading(sessionId) || !isAssistantError(last)) return;
    const prior = sessionMessages.slice(0, -1);
    const lastUser = [...prior].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;

    const imagePrompt = parseImageCommand(lastUser.content);
    if (imagePrompt) {
      await generateImage(imagePrompt, {
        baseMessages: prior,
        skipDuplicateUser: true,
        sessionId,
      });
      return;
    }

    // /papers /books must not fall through to ordinary chat (model cannot run them).
    const literatureCmd = parseLiteratureCommand(lastUser.content);
    if (literatureCmd) {
      if (literatureCmd.action === 'download') {
        await runBookDownload(literatureCmd.identifier, {
          baseMessages: prior,
          skipDuplicateUser: true,
          sessionId,
        });
        return;
      }
      await runLiteratureSearch(literatureCmd.kind, literatureCmd.query, {
        baseMessages: prior,
        skipDuplicateUser: true,
        sessionId,
        source: 'source' in literatureCmd ? literatureCmd.source : undefined,
        action: literatureCmd.action || 'search',
        paperId:
          literatureCmd.kind === 'papers' && 'paperId' in literatureCmd
            ? literatureCmd.paperId
            : undefined,
      });
      return;
    }

    stickToBottomRef.current = true;
    scrollToBottom(true);
    beginLoading(sessionId);

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      incomplete: true,
    };
    updateSession(sessionId, [...prior, assistantMessage]);

    const controller = new AbortController();
    abortControllersRef.current.set(sessionId, controller);
    try {
      await streamChatResponse(
        sessionId,
        toApiMessages(prior, { vision: selectedSpec.vision }),
        assistantMessage.id,
        controller.signal,
      );
    } catch (error: any) {
      failAssistantStream(sessionId, assistantMessage.id, error, 'Reply was interrupted');
    } finally {
      endLoadingIfController(sessionId, controller);
    }
  };

  const editUserMessage = (messageId: string) => {
    if (isActiveLoading) return;
    const sessionId = activeSessionIdRef.current;
    const sessionMsgs =
      sessionsRef.current.find((s) => s.id === sessionId)?.messages || [];
    const message = sessionMsgs.find((m) => m.id === messageId);
    if (!message || message.role !== 'user') return;
    setEditingMessageId(message.id);
    setEditingMessageContent(
      message.content && message.content !== '(image)'
        ? stripUserMessageArtifactsForDisplay(message.content)
        : '',
    );
    setEditingMessageAttachments(messageImagesToIngested(message.images));
  };

  const cancelEditMessage = () => {
    editingMessageAttachments.forEach((a) => {
      if (a.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(a.previewUrl);
    });
    setEditingMessageId(null);
    setEditingMessageContent('');
    setEditingMessageAttachments([]);
  };

  const saveEditedMessage = async (messageId: string) => {
    const content = editingMessageContent.trim();
    const resendImages = ingestedToMessageImages(
      editingMessageAttachments.filter((a) => isImageAttachment(a)),
    );
    const hasTextFiles = editingMessageAttachments.some((a) => a.text);
    // Do not bail on isActiveLoading — stop the in-flight turn then resubmit with force.
    if (!content && resendImages.length === 0 && !hasTextFiles) return;
    if (editingMessageAttachments.some((a) => a.uploading)) {
      setAttachError('Wait for image upload to finish');
      return;
    }
    if (editingMessageAttachments.some((a) => a.uploadError)) {
      setAttachError('Remove or re-add images that failed to upload');
      return;
    }
    if (resendImages.length > 0 && !selectedSpec.vision && !zhipuVisionOn) {
      setAttachError(t('imagesNeedVision'));
      return;
    }
    const sessionId = activeSessionId;
    const sessionMsgs =
      sessionsRef.current.find((s) => s.id === sessionId)?.messages || messages;
    const index = sessionMsgs.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const priorMessages = sessionMsgs.slice(0, index);
    const textToSend = content || (resendImages.length ? '(image)' : '');
    const resendAttachments = [...editingMessageAttachments];
    editingMessageAttachments.forEach((a) => {
      if (a.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(a.previewUrl);
    });
    setEditingMessageId(null);
    setEditingMessageContent('');
    setEditingMessageAttachments([]);

    // force:true so /papers|/books|/image are not blocked by a stale loading flag.
    if (isActiveLoading) {
      stopGenerating();
      setTimeout(() => {
        void handleSubmit(textToSend, priorMessages, true, sessionId, { resendAttachments });
      }, 50);
    } else {
      await handleSubmit(textToSend, priorMessages, true, sessionId, { resendAttachments });
    }
  };






  const stopGenerating = (opts?: { pauseQueue?: boolean; sessionId?: string }) => {
    const pauseQueue = opts?.pauseQueue ?? true;
    const sessionId = opts?.sessionId || activeSessionIdRef.current;
    const controller = abortControllersRef.current.get(sessionId);
    if (controller) {
      controller.abort();
      endLoading(sessionId);
    }
    // Keep the half-written assistant reply resumable after stop/refresh.
    const sessionMsgs = sessionsRef.current.find((s) => s.id === sessionId)?.messages || [];
    const last = sessionMsgs[sessionMsgs.length - 1];
    if (last?.role === 'assistant') {
      markAssistantIncomplete(sessionId, last.id, true, {
        truncationReason: 'Stopped by you',
      });
    }
    // Stopping mid-reply should freeze remaining queued messages for this session.
    if (pauseQueue) {
      setQueuePausedBySession((prev) => pauseSession(prev, sessionId));
    }
  };

  return {
    enqueueOrSubmit,
    cancelQueuedMessage,
    clearQueue,
    resumeQueue,
    jumpQueueAndSubmit,
    runCompact,
    generateImage,
    runLiteratureSearch,
    runBookDownload,
    handleSubmit,
    resumeIncompleteReply,
    requestClaimReview,
    retryFailedReply,
    editUserMessage,
    cancelEditMessage,
    saveEditedMessage,
    stopGenerating,
    loadingBySession,
    messageQueue,
    isSessionLoading,
    isActiveLoading,
    beginLoading,
    endLoading,
    activeQueue,
    queuePaused,
    isCompacting,
    compactNotice,
    clearSessionWork: (sessionId: string) => {
      endLoading(sessionId);
      setMessageQueue((prev) => removeTasksForSession(prev, sessionId));
      setQueuePausedBySession((prev) => clearPauseForSession(prev, sessionId));
    },
  };
}
