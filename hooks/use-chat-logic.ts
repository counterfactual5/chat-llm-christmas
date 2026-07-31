import { useEffect, useMemo, useState } from 'react';
import type { Message, ChatSession } from '@/lib/chat/types';
import type { IngestedAttachment } from '@/lib/files/ingest';
import { parseImageCommand } from '@/lib/chat/image-command';
import { useLocale } from '@/lib/i18n';
import { formatQuotedMessage } from '@/lib/chat/quotes';
import { toApiMessages, ingestedToMessageImages } from '@/lib/chat/api-messages';
import { isImageAttachment } from '@/components/files/AttachmentImageThumb';
import { stripUserMessageArtifactsForDisplay } from '@/lib/tools/image-understand/persist';
import { isAssistantError, messagePlainText } from '@/lib/chat/message-display';
import { estimateTokensFromText } from '@/lib/models/specs';
import { formatWebSourcesForReference } from '@/lib/chat/references';
import { analyzeTruncation, assistantMismatchesUserTopic, buildContinuationPrompt, looksAbruptlyCutOff } from '@/lib/chat/reply-truncation';
import { compactConversationHistory } from '@/lib/chat/compact';

export type QueuedTask = {
  id: string;
  sessionId: string;
  content: string;
  baseMessages?: Message[];
  enqueueTime: number;
};

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
  const isSessionLoading = (sessionId: string) => Boolean(loadingBySession[sessionId]);
  const isActiveLoading = isSessionLoading(activeSessionId);
  const activeQueue = useMemo(
    () => messageQueue.filter((task) => task.sessionId === activeSessionId),
    [messageQueue, activeSessionId],
  );
  const queuePaused = Boolean(queuePausedBySession[activeSessionId]);

  // --- Chat Logic ---
  // Drain each session's queue only when that session is idle and not paused.
  useEffect(() => {
    const toStart: QueuedTask[] = [];
    const seen = new Set<string>();
    for (const task of messageQueue) {
      if (seen.has(task.sessionId)) continue;
      if (loadingBySession[task.sessionId] || queuePausedBySession[task.sessionId]) continue;
      seen.add(task.sessionId);
      toStart.push(task);
    }
    if (toStart.length === 0) return;
    const ids = new Set(toStart.map((task) => task.id));
    setMessageQueue((prev) => prev.filter((task) => !ids.has(task.id)));
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
          setMessageQueue((prev) => [
            ...prev,
            { ...task, id: crypto.randomUUID(), enqueueTime: Date.now() },
          ]);
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
      const next = prev.filter((task) => task.id !== id);
      if (removed && !next.some((task) => task.sessionId === removed.sessionId)) {
        setQueuePausedBySession((p) => {
          if (!p[removed.sessionId]) return p;
          const copy = { ...p };
          delete copy[removed.sessionId];
          return copy;
        });
      }
      return next;
    });
  };

  const clearQueue = () => {
    const sessionId = activeSessionId;
    setMessageQueue((prev) => prev.filter((task) => task.sessionId !== sessionId));
    setQueuePausedBySession((prev) => {
      if (!prev[sessionId]) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  };

  const resumeQueue = () => {
    setQueuePausedBySession((prev) => {
      if (!prev[activeSessionId]) return prev;
      const next = { ...prev };
      delete next[activeSessionId];
      return next;
    });
  };

  const jumpQueueAndSubmit = (id: string) => {
    const task = messageQueue.find((item) => item.id === id);
    if (!task) return;
    setMessageQueue((prev) => prev.filter((item) => item.id !== id));
    // Send Now — abort that session's current reply without freezing the rest.
    if (isSessionLoading(task.sessionId)) {
      stopGenerating({ pauseQueue: false, sessionId: task.sessionId });
    }
    setQueuePausedBySession((prev) => {
      if (!prev[task.sessionId]) return prev;
      const next = { ...prev };
      delete next[task.sessionId];
      return next;
    });
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
    const cleanedBase = sessionMessages.filter(
      (m, idx, arr) => !(idx === arr.length - 1 && m.role === 'assistant' && m.incomplete && !m.content),
    );
    let newTitle = sessionsRef.current.find((s) => s.id === sessionId)?.title;
    if (cleanedBase.length === 0 || (cleanedBase.length === 1 && opts?.skipDuplicateUser)) {
      newTitle = trimmed.slice(0, 30) + (trimmed.length > 30 ? '...' : '');
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
            messages: s.messages.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    // Image alone is enough — don't echo the prompt under the picture.
                    content: '',
                    images: [
                      {
                        url: data.image as string,
                        name: 'generated.png',
                        prompt: trimmed,
                        model: 'GPT Image 1.5',
                        fileId: data.fileId ? String(data.fileId) : undefined,
                      },
                    ],
                    incomplete: false,
                  }
                : m,
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
            messages: s.messages.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: `Error: ${error?.message || 'Image generation failed'}`,
                    incomplete: false,
                    images: undefined,
                  }
                : m,
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
      // Edit/resend passes priorMessages (thread truncated before the edited user
      // turn). Without that, generateImage reads the full session and appends a
      // second `/image` user bubble next to the old one.
      return generateImage(imagePrompt, {
        sessionId,
        alreadyLoading: opts?.alreadyLoading,
        baseMessages: baseMessagesOverride,
      });
    }

    const pendingImages = opts?.resendAttachments
      ? opts.resendAttachments.filter(
          (a) => isImageAttachment(a) && (a.dataUrl || a.fileId),
        )
      : sessionId === activeSessionId
        ? attachments.filter((a) => a.dataUrl || a.fileId)
        : [];
    const pendingTexts = opts?.resendAttachments
      ? opts.resendAttachments.filter((a) => a.text)
      : baseMessagesOverride
        ? []
        : sessionId === activeSessionId
          ? attachments.filter((a) => a.text)
          : [];
    if (
      (!textToSend.trim() && pendingImages.length === 0 && pendingTexts.length === 0) ||
      (!force && isSessionLoading(sessionId) && !opts?.alreadyLoading)
    ) {
      return false;
    }
    if (pendingImages.length > 0 && !selectedSpec.vision && !zhipuVisionOn) {
      if (sessionId === activeSessionId) setAttachError(t('imagesNeedVision'));
      return false;
    }
    const uploadChecks = opts?.resendAttachments ?? (sessionId === activeSessionId ? attachments : []);
    if (uploadChecks.some((a) => a.uploading)) {
      setAttachError('Wait for image upload to finish');
      return false;
    }
    if (uploadChecks.some((a) => a.uploadError)) {
      setAttachError('Remove or re-add images that failed to upload');
      return false;
    }
    if (sessionId === activeSessionId) {
      stickToBottomRef.current = true;
      scrollToBottom(true);
    }

    let fullContent = textToSend.trim();
    if (pendingTexts.length > 0) {
      const contextParts = pendingTexts.map(
        (a) => `[Attached File: ${a.name}]\n${a.text!.trim()}`,
      );
      fullContent = contextParts.join('\n\n') + (fullContent ? `\n\n---\n\n${fullContent}` : '');
    }

    const sessionMessages =
      baseMessagesOverride ??
      sessionsRef.current.find((s) => s.id === sessionId)?.messages ??
      [];
    const cleanedBase = sessionMessages.filter(
      (m, idx, arr) => !(idx === arr.length - 1 && m.role === 'assistant' && m.incomplete && !m.content),
    );

    let baseMessages = cleanedBase;
    let newTitle = sessionsRef.current.find((s) => s.id === sessionId)?.title;
    if (baseMessages.length === 0) {
      newTitle = (textToSend || pendingImages[0]?.name || 'New Conversation').slice(0, 30)
        + ((textToSend.length > 30) ? '...' : '');
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: fullContent || (pendingImages.length ? '(image)' : ''),
      timestamp: Date.now(),
      images: pendingImages.map((a) => ({
        url: a.fileId
          ? `/api/files/${encodeURIComponent(a.fileId)}`
          : a.dataUrl!,
        name: a.name,
        fileId: a.fileId,
      })),
    };

    const historySnapshot = sessionsRef.current.find((s) => s.id === sessionId);

    // Truncate the thread in the UI immediately (edit/resend), so Messages /
    // Context used / Material update before any await (compact / network).
    let newMessages = [...baseMessages, userMessage];
    updateSession(sessionId, newMessages, newTitle);
    if (sessionId === activeSessionId) {
      setInput('');
      attachments.forEach((a) => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      });
      setAttachments([]);
    }

    // Lock the session before await compact so the queue cannot start a second stream.
    if (!opts?.alreadyLoading) beginLoading(sessionId);

    // Compact before sending when the thread is near the selected model's window.
    // usableLimit already follows selectedModel (context − output reserve).
    const estimateForSend = (history: Message[], nextUserText: string) => {
      // fullContent already embeds pending text files — do not also add files.
      // Reference must follow the truncated thread, not the pre-edit sidebar snapshot.
      const threadReference = estimateTokensFromText(
        formatWebSourcesForReference(
          sessionsRef.current.find((s) => s.id === sessionId)?.webSources || [],
        ),
      );
      const historyText = history.reduce(
        (sum, m) => sum + estimateTokensFromText(messagePlainText(m)) + 4,
        0,
      );
      const historyImages = history.reduce(
        (sum, m) => sum + (m.images?.length || 0) * 1000,
        0,
      );
      return (
        contextBreakdown.system +
        contextBreakdown.skills +
        threadReference +
        historyText +
        historyImages +
        pendingImages.length * 1000 +
        estimateTokensFromText(nextUserText)
      );
    };

    const restoreHistoryIfNeeded = () => {
      if (!historySnapshot || !baseMessagesOverride) return;
      updateSession(sessionId, historySnapshot.messages, historySnapshot.title);
    };

    if (usableLimit != null) {
      let projected = estimateForSend(baseMessages, fullContent);
      if (projected > usableLimit * 0.9) {
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
        projected = estimateForSend(baseMessages, fullContent);
        // Still over after compact (huge attachments / short thread): refuse rather than 413 upstream.
        if (projected > usableLimit) {
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
      if (error.name !== 'AbortError') {
        // Keep any partial reply so the user can Continue; only use Error: when empty.
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            const msgs = s.messages.map((m) => {
              if (m.id !== assistantMessage.id) return m;
              if (m.content.trim() || m.reasoning?.trim()) {
                return {
                  ...m,
                  incomplete: true,
                  truncationReason: error.message || 'Request failed',
                };
              }
              return {
                ...m,
                content: `Error: ${error.message || 'Request failed'}`,
                incomplete: false,
                truncationReason: undefined,
              };
            });
            return { ...s, messages: msgs, updatedAt: Date.now() };
          }),
        );
      } else {
        markAssistantIncomplete(sessionId, assistantMessage.id, true, {
          truncationReason: 'Reply was interrupted',
        });
      }
    } finally {
      endLoadingIfController(sessionId, controller);
    }
    return true;
  };

  const resumeIncompleteReply = async (opts?: { force?: boolean }) => {
    const sessionId = activeSessionIdRef.current;
    const sessionMessages = sessionsRef.current.find((s) => s.id === sessionId)?.messages || [];
    const last = sessionMessages[sessionMessages.length - 1];
    if (isSessionLoading(sessionId) || !last || last.role !== 'assistant') return;

    const emptyInterrupted = last.incomplete && !last.content.trim();
    // Refuse to continue a reply that looks complete — matches the visible gate.
    // Manual Continue (force) bypasses the soft gate so the user can always resume.
    if (!opts?.force && !emptyInterrupted) {
      if (!last.content.trim()) return;
      const verdict = analyzeTruncation(
        last.content,
        last.finishReason,
        last.incomplete,
        last.truncationReason,
      );
      if (!verdict.truncated) {
        // Still allow when a tool failed and the body looks unfinished.
        const failedTools = (last.toolRuns || []).some(
          (r) => r.status === 'done' && Boolean(r.error),
        );
        if (!failedTools || !looksAbruptlyCutOff(last.content).truncated) return;
      }
    }
    if (opts?.force && !last.content.trim() && !last.reasoning?.trim() && !last.toolRuns?.length) {
      return;
    }

    stickToBottomRef.current = true;
    scrollToBottom(true);
    beginLoading(sessionId);

    const controller = new AbortController();
    abortControllersRef.current.set(sessionId, controller);

    const lastUser = [...sessionMessages].reverse().find((m) => m.role === 'user');
    // Truly empty bubble (refresh mid-Process, no tokens at all): re-answer.
    // If Thought / tools already ran, keep them — wiping felt like “Continue deleted
    // my half reply” when GLM parked text in reasoning with empty content.
    const hasProcessOrThought = Boolean(
      last.reasoning?.trim() ||
        last.activity?.length ||
        last.toolRuns?.length,
    );
    if (emptyInterrupted && lastUser && !hasProcessOrThought) {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            updatedAt: Date.now(),
            messages: s.messages.map((m) =>
              m.id === last.id
                ? {
                    ...m,
                    content: '',
                    reasoning: undefined,
                    activity: undefined,
                    toolRuns: undefined,
                    incomplete: true,
                    truncationReason: undefined,
                    finishReason: undefined,
                  }
                : m,
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
          '',
          '',
          sessionsRef.current.find((s) => s.id === sessionId)?.webSources || [],
        );
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sessionId) return s;
              const msgs = s.messages.map((m) => {
                if (m.id !== last.id) return m;
                if (m.content.trim() || m.reasoning?.trim()) {
                  return {
                    ...m,
                    incomplete: true,
                    truncationReason: error.message || 'Request failed',
                  };
                }
                return {
                  ...m,
                  content: `Error: ${error.message || 'Request failed'}`,
                  incomplete: false,
                  truncationReason: undefined,
                };
              });
              return { ...s, messages: msgs, updatedAt: Date.now() };
            }),
          );
        } else {
          markAssistantIncomplete(sessionId, last.id, true, {
            truncationReason: 'Reply was interrupted',
          });
        }
      } finally {
        endLoadingIfController(sessionId, controller);
      }
      return;
    }

    // Empty content but Thought/tools already present: ask the model for the
    // visible answer without wiping Process history.
    if (emptyInterrupted && lastUser && hasProcessOrThought) {
      const apiMessages: ReturnType<typeof toApiMessages> = [
        ...toApiMessages(sessionMessages, { vision: selectedSpec.vision }),
        {
          role: 'user' as const,
          content: [
            'Your previous turn was interrupted before any user-visible answer text.',
            'Write the final answer now. Do not restart unrelated tasks.',
            'Do not claim you created/updated Notion pages or invent Notion URLs unless a tool result in this thread already returned that URL.',
          ].join(' '),
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
          '',
          '',
        );
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sessionId) return s;
              const msgs = s.messages.map((m) => {
                if (m.id !== last.id) return m;
                if (m.content.trim() || m.reasoning?.trim()) {
                  return {
                    ...m,
                    incomplete: true,
                    truncationReason: error.message || 'Request failed',
                  };
                }
                return {
                  ...m,
                  content: `Error: ${error.message || 'Request failed'}`,
                  incomplete: false,
                  truncationReason: undefined,
                };
              });
              return { ...s, messages: msgs, updatedAt: Date.now() };
            }),
          );
        } else {
          markAssistantIncomplete(sessionId, last.id, true, {
            truncationReason: 'Reply was interrupted',
          });
        }
      } finally {
        endLoadingIfController(sessionId, controller);
      }
      return;
    }

    const polluted =
      Boolean(lastUser) &&
      assistantMismatchesUserTopic(lastUser!.content, last.content);

    // Cross-chat bleed (e.g. formula chat Continue resumes a Python agent task):
    // steer with a corrective prompt, but never wipe the partial bubble.
    let apiMessages: ReturnType<typeof toApiMessages>;
    let initialContent = last.content;
    let seamPrefix = '';

    if (polluted && lastUser) {
      // Keep the partial bubble — wiping mid-reply felt like Continue "deleted"
      // half the answer. Only steer the model with a corrective user turn.
      apiMessages = [
        ...toApiMessages(sessionMessages, {
          vision: selectedSpec.vision,
        }),
        {
          role: 'user' as const,
          content: [
            'Continue THIS conversation only from where the assistant reply stopped.',
            'Do not restart the answer, and do not continue any other chat\'s tasks, workspace scans, refactors, or tool plans.',
            'Do not mention filesystems, shell, or scanning a workspace unless the user asked for that.',
            buildContinuationPrompt(last.content),
          ].join('\n\n'),
          images: [],
          timestamp: Date.now(),
        },
      ];
      initialContent = last.content;
      const tail = last.content.trimEnd();
      const lastLine = tail.split('\n').pop() ?? '';
      seamPrefix = /^\s*\|.*\|\s*$/.test(lastLine) ? '\n' : '';
    } else {
      apiMessages = [
        ...toApiMessages(sessionMessages, { vision: selectedSpec.vision }),
        {
          role: 'user' as const,
          content: buildContinuationPrompt(last.content),
          images: [],
          timestamp: Date.now(),
        },
      ];
      const tail = last.content.trimEnd();
      const lastLine = tail.split('\n').pop() ?? '';
      seamPrefix = /^\s*\|.*\|\s*$/.test(lastLine) ? '\n' : '';
    }

    try {
      await streamChatResponse(
        sessionId,
        apiMessages,
        last.id,
        controller.signal,
        initialContent,
        seamPrefix,
      );
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        // Keep partial resumed text; fall back to Error only if somehow empty.
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            const msgs = s.messages.map((m) => {
              if (m.id !== last.id) return m;
              if (m.content.trim()) {
                return {
                  ...m,
                  incomplete: true,
                  truncationReason: error.message || 'Request failed',
                };
              }
              return {
                ...m,
                content: `Error: ${error.message || 'Request failed'}`,
                incomplete: false,
              };
            });
            return { ...s, messages: msgs, updatedAt: Date.now() };
          }),
        );
      } else {
        markAssistantIncomplete(sessionId, last.id, true, {
          truncationReason: 'Stopped by you',
        });
      }
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
        content:
          'Claim Review: audit your previous assistant answer. For each claim of a tool action, web search, or factual statement, verify it against the tool results in this conversation. Retract any claim that lacks a real tool receipt; otherwise confirm it is verified. Be brief.',
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
      if (error.name !== 'AbortError') {
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            return {
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantMessage.id
                  ? {
                      ...m,
                      content: `Error: ${error.message || 'Request failed'}`,
                      incomplete: false,
                    }
                  : m,
              ),
              updatedAt: Date.now(),
            };
          }),
        );
      } else {
        markAssistantIncomplete(sessionId, assistantMessage.id, true, {
          truncationReason: 'Stopped by you',
        });
      }
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
      if (error.name !== 'AbortError') {
        updateSession(sessionId, [
          ...prior,
          {
            id: assistantMessage.id,
            role: 'assistant',
            content: `Error: ${error.message || 'Request failed'}`,
            timestamp: Date.now(),
            incomplete: false,
          },
        ]);
      } else {
        markAssistantIncomplete(sessionId, assistantMessage.id, true, {
          truncationReason: 'Reply was interrupted',
        });
      }
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
      setQueuePausedBySession((prev) => ({ ...prev, [sessionId]: true }));
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
      setMessageQueue((prev) => prev.filter((task) => task.sessionId !== sessionId));
      setQueuePausedBySession((prev) => {
        if (!prev[sessionId]) return prev;
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
    },
  };
}
