/**
 * Send / queue / image-gen / resume / claim-review / edit-retry for the active chat.
 *
 *  Queue helpers:   lib/chat/turn/task-queue.ts
 *  Continue/review: lib/chat/turn/continuation.ts
 *  Attachments:     lib/chat/turn/attachments.ts
 *  Send estimate:   lib/chat/turn/send-estimate.ts
 *  Stream errors:   lib/chat/turn/stream-error.ts
 *  Account:         hooks/chat/use-account.ts
 *  Integrations:    hooks/chat/use-integrations.ts
 *  Persist:         hooks/chat/use-session-persist.ts
 *  SSE parse:       lib/chat/stream/client.ts
 */
import { useEffect, useMemo, useState } from 'react';
import type { Message, ChatSession } from '@/lib/chat/types';
import type { IngestedAttachment } from '@/lib/files/ingest';
import { parseImageCommand } from '@/lib/chat/turn/image-command';
import { useLocale } from '@/lib/i18n';
import { formatQuotedMessage } from '@/lib/chat/message/quotes';
import { toApiMessages, ingestedToMessageImages } from '@/lib/chat/message/api-messages';
import { isImageAttachment } from '@/components/files/AttachmentImageThumb';
import { stripUserMessageArtifactsForDisplay } from '@/lib/tools/image-understand/persist';
import { isAssistantError } from '@/lib/chat/message/display';
import { compactConversationHistory } from '@/lib/chat/turn/compact';
import {
  afterRemoveTask,
  clearPauseForSession,
  pauseSession,
  removeTaskById,
  removeTasksById,
  removeTasksForSession,
  requeueFailedTask,
  selectTasksToDrain,
  tasksForSession,
  type QueuedTask,
} from '@/lib/chat/turn/task-queue';
import {
  CLAIM_REVIEW_USER_PROMPT,
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
  ) => Promise<void>;
  
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
  const [messageQueue, setMessageQueue] = useState<QueuedTask[]>([]);
  const [queuePausedBySession, setQueuePausedBySession] = useState<Record<string, boolean>>({});
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
  const activeQueue = useMemo(
    () => tasksForSession(messageQueue, activeSessionId),
    [messageQueue, activeSessionId],
  );
  const queuePaused = Boolean(queuePausedBySession[activeSessionId]);

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
    const quotes = fromComposer ? quotedSelections : [];
    const textToSend = formatQuotedMessage(raw, quotes);
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

  const cancelQueuedMessage = (id: string) => {
    setMessageQueue((prev) => {
      const removed = prev.find((task) => task.id === id);
      const next = removeTaskById(prev, id);
      setQueuePausedBySession((p) => afterRemoveTask(next, removed, p));
      return next;
    });
  };

  const clearQueue = () => {
    const sessionId = activeSessionId;
    setMessageQueue((prev) => removeTasksForSession(prev, sessionId));
    setQueuePausedBySession((prev) => clearPauseForSession(prev, sessionId));
  };

  const resumeQueue = () => {
    setQueuePausedBySession((prev) => clearPauseForSession(prev, activeSessionId));
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
    let newTitle = sessionsRef.current.find((s) => s.id === sessionId)?.title;
    if (cleanedBase.length === 0 || (cleanedBase.length === 1 && opts?.skipDuplicateUser)) {
      newTitle = titleForNewConversation(trimmed);
    }

    const assistantId = crypto.randomUUID();
    const assistantMessage: Message = {
      id: assistantId,
      role: 'assistant',
      content: 'Generating image…',
      timestamp: Date.now(),
      incomplete: true,
    };

    const thread = opts?.skipDuplicateUser
      ? [...cleanedBase, assistantMessage]
      : [
          ...cleanedBase,
          {
            id: crypto.randomUUID(),
            role: 'user' as const,
            content: `/image ${trimmed}`,
            timestamp: Date.now(),
          },
          assistantMessage,
        ];
    updateSession(sessionId, thread, newTitle);

    try {
      const res = await fetch('/api/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: trimmed,
          model: 'gpt-image-1.5',
          size: '1024x1024',
          quality: 'medium',
        }),
      });
      const raw = await res.text();
      let data: {
        error?: string;
        image?: string;
        fileId?: string;
      } = {};
      try {
        data = raw ? (JSON.parse(raw) as typeof data) : {};
      } catch {
        throw new Error(
          raw.trim().slice(0, 400) ||
            `Image API returned non-JSON (HTTP ${res.status})`,
        );
      }
      if (!res.ok) throw new Error(data?.error || `Image generation failed (HTTP ${res.status})`);
      if (!data?.image) throw new Error('No image returned');

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            messages: mapAssistantById(s.messages, assistantId, (m) =>
              applyGeneratedImageToAssistant(m, {
                imageUrl: data.image as string,
                prompt: trimmed,
                fileId: data.fileId ? String(data.fileId) : undefined,
              }),
            ),
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
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            messages: mapAssistantById(s.messages, assistantId, (m) =>
              applyImageGenerationError(m, error?.message || 'Image generation failed'),
            ),
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
    let baseMessages = cleanBaseMessagesForSend(sessionMessages);
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

    const projectTokens = (history: Message[]) =>
      estimateTokensForSend({
        history,
        nextUserText: fullContent,
        pendingImageCount: pendingImages.length,
        webSources: sessionsRef.current.find((s) => s.id === sessionId)?.webSources || [],
        contextBreakdown,
      });

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
    const threadSources = sessionsRef.current.find((s) => s.id === sessionId)?.webSources || [];

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
  const requestClaimReview = async () => {
    const sessionId = activeSessionIdRef.current;
    if (!isAccountBound) {
      openLoginModal();
      return;
    }
    const sessionMessages = sessionsRef.current.find((s) => s.id === sessionId)?.messages || [];
    const lastAssistant = [...sessionMessages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant || isSessionLoading(sessionId)) return;

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
    updateSession(sessionId, [...sessionMessages, assistantMessage]);

    const apiMessages: ReturnType<typeof toApiMessages> = [
      ...toApiMessages(sessionMessages, { vision: selectedSpec.vision }),
      {
        role: 'user' as const,
        content: CLAIM_REVIEW_USER_PROMPT,
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
    if ((!content && resendImages.length === 0 && !hasTextFiles) || isActiveLoading) return;
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

    if (isActiveLoading) {
      stopGenerating();
      setTimeout(() => {
        void handleSubmit(textToSend, priorMessages, false, sessionId, { resendAttachments });
      }, 50);
    } else {
      await handleSubmit(textToSend, priorMessages, false, sessionId, { resendAttachments });
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
