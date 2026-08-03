'use client';

/**
 * Chat shell — wires UI panels to hooks. Prefer jumping to the owning module:
 *
 *  Account status                  hooks/chat/use-account.ts + lib/chat/account/client.ts
 *  Notion/GitHub/Google status     hooks/chat/use-integrations.ts + lib/chat/integrations/client.ts
 *  Session hydrate / persist       hooks/chat/use-session-persist.ts + lib/chat/session/persist.ts
 *  Attachments ingest / upload     hooks/chat/use-attachments.ts
 *  Skills toggle / create / delete hooks/chat/use-skills.ts
 *  Account memories / extract      hooks/chat/use-memory-wiring.ts (+ use-memories, lib/memories/)
 *  Slash menu                      hooks/chat/use-slash.ts
 *  OAuth return query              lib/chat/account/oauth-return.ts
 *  Send / queue / resume / review   hooks/chat/use-logic.ts
 *    queue state                   hooks/chat/use-chat-queue.ts
 *    queue helpers                 lib/chat/turn/task-queue.ts
 *    continue / claim-review plan  lib/chat/turn/continuation.ts
 *  /image, /research, skill slash     lib/chat/turn/image-command.ts, research-command.ts, research-activity.ts, skill-command.ts
 *  Deep research (main-chat timeline) hooks/chat/use-deep-research.ts
 *  Client SSE consumer             lib/chat/stream/client.ts
 *  Session normalize / LWW merge   lib/chat/session/store.ts
 *  Message list / composer / …     components/chat/*
 *    answer markdown               components/chat/message/AnswerMarkdown.tsx
 *  IME guards / file download      lib/chat/composer/*
 *  /api/chat HTTP entry            app/api/chat/route.ts
 *  /api/chat pipeline              lib/chat/server/chat-request.ts (+ lib/chat/server/)
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Eye,
  Layers,
  Menu,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  ChatSession,
  ExternalReferenceSourceKind,
  Message,
  ModelOption,
  SkillItem,
  WebSearchSource,
} from '@/lib/chat/types';
import {
  collectUserUploadsFromMessages,
  collectWebSourcesFromMessages,
  formatWebSourcesForReference,
  referenceSourceKind,
  webSourcesForThread,
} from '@/lib/chat/context/references';
import {
  analyzeTruncation,
  hasSuccessfulRetrievalTools,
  looksAbruptlyCutOff,
  shortenTruncationReason,
} from '@/lib/chat/stream/reply-truncation';
import { isAssistantError, messagePlainText } from '@/lib/chat/message/display';
import { useChatLogic } from '@/hooks/chat/use-logic';
import { useDeepResearch } from '@/hooks/chat/use-deep-research';
import { useChatAccount } from '@/hooks/chat/use-account';
import { useChatIntegrations } from '@/hooks/chat/use-integrations';
import { useChatSessionPersist } from '@/hooks/chat/use-session-persist';
import { useChatAttachments } from '@/hooks/chat/use-attachments';
import { useChatSkills } from '@/hooks/chat/use-skills';
import { useMemoryWiring } from '@/hooks/chat/use-memory-wiring';
import { useChatSlash } from '@/hooks/chat/use-slash';
import { parseImageCommand } from '@/lib/chat/turn/image-command';
import {
  formatResearchCommand,
  parseResearchCommand,
  type ResearchModeHint,
  type ResearchSourcesHint,
} from '@/lib/chat/turn/research-command';
import { parseReviewCommand } from '@/lib/chat/turn/review-command';
import { parseLiteratureCommand } from '@/lib/chat/turn/literature-command';
import { clearLocalSessions } from '@/lib/chat/session/persist';
import {
  clearOAuthReturnQuery,
  oauthReturnNeedsUrlClean,
  parseOAuthReturnParams,
  planOAuthReturnUi,
  type AuthModalMode,
} from '@/lib/chat/account/oauth-return';
import { enableGoogleSurfacesOnNewestSession } from '@/lib/chat/integrations/client';
import { bindImeGuards, isEnterSubmitBlockedByIme } from '@/lib/chat/composer/ime';
import {
  downloadGeneratedFile,
  downloadGeneratedImage,
} from '@/lib/chat/composer/download';
import {
  type GeneratedFileEntry,
  type GeneratedImageEntry,
} from '@/components/chat/panels/OutputPanel';
import { ChatSidebar } from '@/components/chat/session/ChatSidebar';
import { ChatComposer } from '@/components/chat/composer/ChatComposer';
import { ChatMessageList } from '@/components/chat/message/ChatMessageList';
import { ChatContextPanel } from '@/components/chat/panels/ChatContextPanel';
import { ChatPreviewPanel } from '@/components/chat/panels/ChatPreviewPanel';
import { ChatModals } from '@/components/chat/overlays/ChatModals';
import { ChatQuoteToolbar } from '@/components/chat/overlays/ChatQuoteToolbar';
import {
  appendQuotedSelection,
  parseQuotedUserMessage,
} from '@/lib/chat/message/quotes';
import {
  messageImagesToIngested,
  sessionHasImages,
  toApiMessages,
} from '@/lib/chat/message/api-messages';
import { withMarkedAssistantIncomplete } from '@/lib/chat/session/mutations';
import { streamChatResponse as runStreamChatResponse } from '@/lib/chat/stream/client';
import { BUILTIN_SKILLS, SKILL_CREATOR_ID } from '@/lib/skills/creator';
import { isImageAttachment } from '@/components/files/AttachmentImageThumb';
import type { FilePreviewPayload } from '@/components/files/FilePreviewOverlay';
import { FileManagerModal } from '@/components/files/FileManagerModal';
import { MemoryManagerModal } from '@/components/memories/MemoryManagerModal';
import {
  DEFAULT_SYSTEM_PROMPT,
  estimateTokensFromText,
  getModelSpec,
} from '@/lib/models/specs';
import { useLocale } from '@/lib/i18n';
import {
  isGoogleMcpId,
  normalizeGoogleIntegrations,
} from '@/lib/integrations/google/services';


export default function ChatContainer() {
  const { t, locale, setLocale } = useLocale();
  // State
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [input, setInput] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageContent, setEditingMessageContent] = useState('');

  // Model & Auth State
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState(() => {
    if (typeof window === 'undefined') return '';
    try {
      return localStorage.getItem('llm_christmas_selected_model') || '';
    } catch {
      return '';
    }
  });
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [tempKeyInput, setTempKeyInput] = useState<string>('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  /** `notion` | `github` = MCP connect sheet; `login` = first-time sign-in only. */
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>('login');
  const [showApiKeyLogin, setShowApiKeyLogin] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);

  // Settings State
  const [sessionPendingDelete, setSessionPendingDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [confirmClearSourcesOpen, setConfirmClearSourcesOpen] = useState(false);
  /**
   * After Thought / answer text goes idle but the turn is still open, show a
   * textless spinner under the bubble (not a fake "Thinking…" label).
   */
  const [replyWaitByMessage, setReplyWaitByMessage] = useState<Record<string, boolean>>({});

  // Skills / attachments state lives in dedicated hooks (wired below after account + session helpers).
  const [googleMcpMenuOpen, setGoogleMcpMenuOpen] = useState(false);
  const [plusFlyout, setPlusFlyout] = useState<
    null | 'commands' | 'skills' | 'mcp' | 'tools'
  >(null);
  const [isSkillPickerOpen, setIsSkillPickerOpen] = useState(false);
  const skillPickerRef = useRef<HTMLDivElement>(null);
  const plusMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(false);
  const [isPreviewPanelOpen, setIsPreviewPanelOpen] = useState(false);
  const [previewFileEntry, setPreviewFileEntry] = useState<GeneratedFileEntry | null>(null);
  const openFilePreview = (entry: GeneratedFileEntry) => {
    setPreviewFileEntry(entry);
    setIsPreviewPanelOpen(true);
  };
  const [picturesExpanded, setPicturesExpanded] = useState(false);
  const [referenceExpanded, setReferenceExpanded] = useState(false);
  /** Per-source groups within Reference Material; all start collapsed. */
  const [referenceGroupsOpen, setReferenceGroupsOpen] = useState<Record<string, boolean>>({});
  /** Images / Files subgroups inside Output; all start collapsed. */
  const [outputGroupsOpen, setOutputGroupsOpen] = useState<Record<string, boolean>>({});
  const [systemPromptExpanded, setSystemPromptExpanded] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  /** When the user explicitly clears web sources, suppress auto-restore from history. */
  const [webSourcesCleared, setWebSourcesCleared] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [imagePreviewSrc, setImagePreviewSrc] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<FilePreviewPayload | null>(null);
  const [filesManagerOpen, setFilesManagerOpen] = useState(false);

  // Settings State
  const [isListening, setIsListening] = useState(false);
  const [queueExpanded, setQueueExpanded] = useState(true);
  /** Explicit open/closed overrides for reasoning panels (message id → open). */
  const [reasoningOpen, setReasoningOpen] = useState<Record<string, boolean>>({});
  const [toolRunOpen, setToolRunOpen] = useState<Record<string, boolean>>({});
  /** Text snippets quoted from message selection into the composer (multi-select). */
  const [quotedSelections, setQuotedSelections] = useState<string[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerImeComposingRef = useRef(false);
  /** Suppress Enter-to-send right after IME commits (same key often confirms composition). */
  const composerImeEnterLockRef = useRef(false);
  const editImeComposingRef = useRef(false);
  const editImeEnterLockRef = useRef(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const sessionsRef = useRef(sessions);
  const activeSessionIdRef = useRef(activeSessionId);
  const skillsRef = useRef<SkillItem[]>([]);
  const dragDepthRef = useRef(0);
  // Only auto-follow new tokens while the user is already near the bottom.
  const stickToBottomRef = useRef(true);

  sessionsRef.current = sessions;
  activeSessionIdRef.current = activeSessionId;

  const createNewSession = useCallback(() => {
    // Switch to a blank composer. The draft is kept in memory only and is
    // omitted from the sidebar until the first message lands.
    setQuotedSelections([]);
    setSessions((prev) => {
      const emptyDraft = prev.find((session) => session.messages.length === 0);

      if (emptyDraft) {
        setActiveSessionId(emptyDraft.id);
        return prev
          .filter(
            (session) => session.messages.length > 0 || session.id === emptyDraft.id,
          )
          .map((session) =>
            session.id === emptyDraft.id
              ? { ...session, updatedAt: Date.now() }
              : session,
          );
      }

      const newSession: ChatSession = {
        id: crypto.randomUUID(),
        title: 'New Conversation',
        messages: [],
        updatedAt: Date.now(),
      };
      setActiveSessionId(newSession.id);
      // Drop any stray empty drafts while creating a fresh one.
      return [newSession, ...prev.filter((session) => session.messages.length > 0)];
    });
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  }, []);

  const setActiveMcpIds = useCallback(
    (updater: string[] | ((prev: string[]) => string[])) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== activeSessionId) return s;
          const next = typeof updater === 'function' ? updater(s.mcpIds || []) : updater;
          return { ...s, mcpIds: next, updatedAt: Date.now() };
        }),
      );
    },
    [activeSessionId],
  );

  const setActiveSkillIds = useCallback(
    (updater: string[] | ((prev: string[]) => string[])) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== activeSessionId) return s;
          const next = typeof updater === 'function' ? updater(s.skillIds || []) : updater;
          return { ...s, skillIds: next, updatedAt: Date.now() };
        }),
      );
    },
    [activeSessionId],
  );

  const fetchModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const res = await fetch('/api/models', {
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success && Array.isArray(data.models)) {
        setAvailableModels(data.models);
        if (data.models.length > 0) {
          setSelectedModel((prev) => {
            if (prev && data.models.some((m: ModelOption) => m.id === prev)) return prev;
            let saved = '';
            try {
              saved = localStorage.getItem('llm_christmas_selected_model') || '';
            } catch {}
            if (saved && data.models.some((m: ModelOption) => m.id === saved)) return saved;
            return data.models[0].id;
          });
        } else {
          setSelectedModel('');
        }
      } else {
        console.error('Failed to fetch models', data?.error || res.status);
      }
    } catch (e) {
      console.error('Failed to fetch models', e);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const {
    isAccountBound,
    accountUsername,
    refreshAccountStatus,
    bindWithApiKey,
    disconnectAccountCore,
  } = useChatAccount();

  const {
    attachments,
    setAttachments,
    attachmentsExpanded,
    setAttachmentsExpanded,
    editingMessageAttachments,
    setEditingMessageAttachments,
    attachError,
    setAttachError,
    addIngestedFiles,
    addEditIngestedFiles,
    removeAttachment,
    removeEditingMessageAttachment,
  } = useChatAttachments({ isAccountBound });

  const {
    skills,
    setSkills,
    isSavingSkill,
    showSkillModal,
    setShowSkillModal,
    skillModalMode,
    previewSkillId,
    skillDraftTitle,
    setSkillDraftTitle,
    skillDraftDescription,
    setSkillDraftDescription,
    skillDraftContent,
    setSkillDraftContent,
    skillModalError,
    setSkillModalError,
    skillPendingDelete,
    setSkillPendingDelete,
    isDeletingSkill,
    toggleSkill,
    attachSkill,
    openNewSkillModal,
    openSkillPreview,
    createSkill,
    requestDeleteSkill,
    confirmDeleteSkill,
  } = useChatSkills({ setActiveSkillIds, setIsSkillPickerOpen });

  const {
    memories,
    setMemories,
    memoriesLoading,
    memoriesError,
    memoriesSaving,
    fetchMemories,
    updateMemory,
    deleteMemory,
    exportMarkdown,
    importMarkdown,
    memoriesPayload,
    memoriesManagerOpen,
    openMemoriesModal,
    closeMemoriesModal,
    memorySavedNotice,
    dismissMemorySavedNotice,
    onReplySettled: onMemoryReplySettled,
  } = useMemoryWiring({
    setSessions,
    getSession: (id) => sessionsRef.current.find((s) => s.id === id),
    selectedModel,
    isAccountBound,
  });

  skillsRef.current = skills;

  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/skills', { cache: 'no-store' });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setSkills(json.data);
      }
    } catch (e) {
      console.error('Failed to fetch skills', e);
    }
  }, [setSkills]);

  const {
    chatsHydrated,
    hydrateBoundAccount,
    hydrateGuest,
  } = useChatSessionPersist({
    sessions,
    setSessions,
    setActiveSessionId,
    createNewSession,
    isAccountBound,
    onCloudSyncError: (message) => setAttachError(message),
    onCrossTabMerge: () => setAttachError('Chats updated from another tab.'),
  });

  const {
    notionStatus,
    setNotionStatus,
    notionBusy,
    githubStatus,
    setGitHubStatus,
    githubBusy,
    googleStatus,
    setGoogleStatus,
    googleBusy,
    fetchIntegrations,
    disconnectNotion,
    disconnectGitHub,
    disconnectGoogle,
  } = useChatIntegrations({
    setSessions,
    setActiveMcpIds,
    isAccountBound,
    showAuthModal,
    authModalMode,
  });

  // One-time startup: account → hydrate sessions → models/skills/integrations → OAuth return UI.
  useEffect(() => {
    localStorage.removeItem('llm_christmas_user_key');
    const oauth = parseOAuthReturnParams(window.location.search);
    if (oauthReturnNeedsUrlClean(oauth)) clearOAuthReturnQuery();

    void refreshAccountStatus()
      .then(async ({ bound, username }) => {
        if (bound) await hydrateBoundAccount(username);
        else hydrateGuest();

        const boot: Array<Promise<unknown>> = [fetchModels()];
        if (bound) boot.push(fetchSkills(), fetchMemories(), fetchIntegrations());
        await Promise.all(boot);

        for (const action of planOAuthReturnUi(oauth, bound)) {
          if (action.type === 'close_modal') {
            setAccountError('');
            setShowAuthModal(false);
          } else if (action.type === 'open_modal') {
            setAuthModalMode(action.mode);
            if (action.error) setAccountError(action.error);
            else setAccountError('');
            setShowAuthModal(true);
          } else if (action.type === 'google_connected') {
            await fetchIntegrations();
            setSessions((prev) => enableGoogleSurfacesOnNewestSession(prev));
          }
        }
      })
      .catch(() => {
        void fetchModels();
        hydrateGuest();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only startup
  }, []);

  const notionStatusRef = useRef(notionStatus);
  const githubStatusRef = useRef(githubStatus);
  const googleStatusRef = useRef(googleStatus);
  notionStatusRef.current = notionStatus;
  githubStatusRef.current = githubStatus;
  googleStatusRef.current = googleStatus;

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const messages = activeSession?.messages || [];

  useEffect(() => {
    if (!imagePreviewSrc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImagePreviewSrc(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imagePreviewSrc]);

  useEffect(() => {
    if (!filePreview) return;
    // Overlay also listens; keep body scroll locked while open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [filePreview]);
  const activeSkillIds = activeSession?.skillIds || [];
  const activeMcpIds = activeSession?.mcpIds || [];
  const activeAutoReview = activeSession?.autoReview ?? true;
  const setActiveAutoReview = (v: boolean) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSessionId ? { ...s, autoReview: v } : s)),
    );
  };
  // Opt-in model tool (default OFF) — slash /image always works.
  // /papers and /books are command-only (no mid-reply Tools toggle).
  const generateImageEnabled = activeMcpIds.includes('generate_image');
  const setGenerateImageEnabled = (enabled: boolean) => {
    if (enabled && !isAccountBound) {
      openLoginModal();
      return;
    }
    setActiveMcpIds((prev) =>
      enabled
        ? prev.includes('generate_image')
          ? prev
          : [...prev, 'generate_image']
        : prev.filter((x) => x !== 'generate_image'),
    );
  };
  const webSources = activeSession?.webSources || [];
  const userUploadReferences = useMemo(() => {
    const fromThread = collectUserUploadsFromMessages(messages);
    const seen = new Set(fromThread.map((s) => s.url || `${s.title}:${s.snippet?.slice(0, 40)}`));
    const pending: WebSearchSource[] = [];
    for (const a of attachments) {
      const url = a.fileId
        ? `/api/files/${encodeURIComponent(a.fileId)}`
        : a.previewUrl || a.dataUrl || '';
      const key = url || `pending:${a.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pending.push({
        title: a.name,
        url: isImageAttachment(a) ? url : '',
        snippet: a.text?.slice(0, 400) || '',
        provider: 'upload',
        query: 'upload',
        kind: isImageAttachment(a) ? 'image' : 'file',
      });
    }
    return [...fromThread, ...pending];
  }, [messages, attachments]);

  const referenceSourceGroups = useMemo(() => {
    const order: ExternalReferenceSourceKind[] = [
      'web',
      'notion',
      'github',
      'gmail',
      'calendar',
      'drive',
      'google',
    ];
    const grouped = new Map<ExternalReferenceSourceKind, WebSearchSource[]>();
    for (const source of webSources) {
      const kind: ExternalReferenceSourceKind =
        source.sourceKind && source.sourceKind !== 'upload'
          ? source.sourceKind
          : referenceSourceKind(source.provider, undefined);
      grouped.set(kind, [...(grouped.get(kind) || []), source]);
    }
    return order
      .map((kind) => ({ kind, sources: grouped.get(kind) || [] }))
      .filter((group) => group.sources.length > 0);
  }, [webSources]);

  const scrollToMessage = (messageId: string) => {
    const element = document.getElementById(`message-${messageId}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element?.animate(
      [
        { backgroundColor: 'transparent' },
        { backgroundColor: 'rgba(245, 158, 11, 0.14)' },
        { backgroundColor: 'transparent' },
      ],
      { duration: 1200, easing: 'ease-out' },
    );
  };

  const openUploadReference = (source: WebSearchSource) => {
    if (source.messageId) {
      scrollToMessage(source.messageId);
    } else if (source.url && !source.url.startsWith('data:') && !source.url.startsWith('/api/files/')) {
      window.open(source.url, '_blank', 'noopener,noreferrer');
    }
  };
  const notionMcpOn =
    Boolean(notionStatus?.connected) && activeMcpIds.includes('notion');
  const githubMcpOn =
    Boolean(githubStatus?.connected) && activeMcpIds.includes('github');
  const googleMcpConnected = Boolean(googleStatus?.connected);
  const gmailMcpOn = googleMcpConnected && activeMcpIds.includes('gmail');
  const calendarMcpOn = googleMcpConnected && activeMcpIds.includes('calendar');
  const driveMcpOn = googleMcpConnected && activeMcpIds.includes('drive');
  /** Zhipu Vision MCP — no OAuth, just needs a logged-in CPA account. */
  const zhipuVisionOn = isAccountBound && activeMcpIds.includes('zhipu-vision');

  const accountDisplayName =
    accountUsername || (isAccountBound ? t('accountConnected') : t('connectAccount'));

  // If Notion/GitHub/Google OAuth is gone, strip it from every chat's mcpIds.
  // Important: status starts as null (not yet fetched). Do NOT treat null as
  // "disconnected" or we wipe per-chat mcpIds before integrations load / on
  // transient fetch failures — which looks like the MCP toggle "won't save".
  useEffect(() => {
    if (notionStatus === null) return; // still loading
    if (notionStatus.connected) return;
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (!(s.mcpIds || []).includes('notion')) return s;
        changed = true;
        return { ...s, mcpIds: (s.mcpIds || []).filter((id) => id !== 'notion') };
      });
      return changed ? next : prev;
    });
  }, [notionStatus]);

  useEffect(() => {
    if (githubStatus === null) return; // still loading
    if (githubStatus.connected) return;
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (!(s.mcpIds || []).includes('github')) return s;
        changed = true;
        return { ...s, mcpIds: (s.mcpIds || []).filter((id) => id !== 'github') };
      });
      return changed ? next : prev;
    });
  }, [githubStatus]);

  useEffect(() => {
    if (googleStatus === null) return; // still loading
    if (googleStatus.connected) return;
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (!(s.mcpIds || []).some((id) => isGoogleMcpId(id))) return s;
        changed = true;
        return { ...s, mcpIds: (s.mcpIds || []).filter((id) => !isGoogleMcpId(id)) };
      });
      return changed ? next : prev;
    });
  }, [googleStatus]);

  // Migrate legacy per-chat `google` toggle → gmail + calendar + drive.
  useEffect(() => {
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (!(s.mcpIds || []).includes('google')) return s;
        changed = true;
        return {
          ...s,
          mcpIds: normalizeGoogleIntegrations(s.mcpIds || []),
          updatedAt: Date.now(),
        };
      });
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;
    // User explicitly cleared web sources — don't auto-restore from history.
    if (webSourcesCleared || activeSession?.webSourcesCleared) return;
    const collected = collectWebSourcesFromMessages(messages);
    const stored = activeSession?.webSources || [];
    const collectedKey = collected.map((c) => c.url).join('\n');
    const storedKey = stored.map((c) => c.url).join('\n');
    if (collectedKey === storedKey) return;
    const grew = collected.length > stored.length;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId ? { ...s, webSources: collected } : s,
      ),
    );
    if (grew && collected.length > 0) {
      queueMicrotask(() => setIsContextPanelOpen(true));
    }
  }, [activeSessionId, messages, activeSession?.webSources, webSourcesCleared]);
  const activeSkills = useMemo(
    () =>
      activeSkillIds
        .map((id) =>
          BUILTIN_SKILLS.find((skill) => skill.id === id) ||
          skills.find((skill) => skill.id === id),
        )
        .filter(
          (skill): skill is SkillItem =>
            Boolean(skill) && skill?.id !== SKILL_CREATOR_ID,
        ),
    [activeSkillIds, skills],
  );


  const generatedImageHistory = useMemo((): GeneratedImageEntry[] => {
    const out: GeneratedImageEntry[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role !== 'assistant' || !m.images?.length) continue;
      const prev = messages[i - 1];
      const fromCmd =
        prev?.role === 'user' ? parseImageCommand(prev.content) : null;
      m.images.forEach((img, imageIndex) => {
        // Assistant images in this app are from /image; user uploads sit on user turns.
        out.push({
          messageId: m.id,
          imageIndex,
          url: img.url,
          prompt: img.prompt || fromCmd || img.name || 'Image',
          model: img.model || 'GPT Image',
          timestamp: m.timestamp,
        });
      });
    }
    return out.slice().reverse();
  }, [messages]);

  const generatedFileHistory = useMemo((): GeneratedFileEntry[] => {
    const out: GeneratedFileEntry[] = [];
    for (const m of messages) {
      if (m.role !== 'assistant' || !m.files?.length) continue;
      m.files.forEach((file, fileIndex) => {
        out.push({
          messageId: m.id,
          fileIndex,
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          url: file.url,
          content: file.content,
          createdAt: file.createdAt || m.timestamp,
        });
      });
    }
    return out.slice().reverse();
  }, [messages]);

  const isEmptyAssistantShell = (m: Message) =>
    m.role === 'assistant' &&
    !m.content?.trim() &&
    !m.images?.length &&
    !m.files?.length &&
    !m.reasoning &&
    !m.toolRuns?.length;

  const deleteStoredFile = async (fileId: string) => {
    if (!fileId || fileId.startsWith('local:')) return;
    const res = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) {
      const data = await res.json().catch(() => ({}));
      throw new Error(String(data?.error || `Delete file failed (${res.status})`));
    }
  };

  const removeGeneratedImage = (entry: GeneratedImageEntry) => {
    const message = messages.find((item) => item.id === entry.messageId);
    const image = message?.images?.[entry.imageIndex];
    if (image?.fileId) {
      void deleteStoredFile(image.fileId).catch((error) =>
        console.warn('[files] delete generated image failed:', error),
      );
    }
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        const nextMessages = s.messages
          .map((m) => {
            if (m.id !== entry.messageId || !m.images?.length) return m;
            const images = m.images.filter((_, idx) => idx !== entry.imageIndex);
            return { ...m, images: images.length ? images : undefined };
          })
          .filter((m) => !isEmptyAssistantShell(m));
        return { ...s, messages: nextMessages, updatedAt: Date.now() };
      }),
    );
  };

  const removeGeneratedFile = (entry: GeneratedFileEntry) => {
    if (!entry.url.startsWith('local://')) {
      void deleteStoredFile(entry.id).catch((error) =>
        console.warn('[files] delete generated file failed:', error),
      );
    }
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        const nextMessages = s.messages
          .map((m) => {
            if (m.id !== entry.messageId || !m.files?.length) return m;
            const files = m.files.filter((_, idx) => idx !== entry.fileIndex);
            const activity = (m.activity || []).filter(
              (step) => !(step.kind === 'file' && step.fileId === entry.id),
            );
            return {
              ...m,
              files: files.length ? files : undefined,
              activity: activity.length ? activity : undefined,
            };
          })
          .filter((m) => !isEmptyAssistantShell(m));
        return { ...s, messages: nextMessages, updatedAt: Date.now() };
      }),
    );
  };

  const openLoginModal = () => {
    if (isAccountBound) return;
    setAuthModalMode('login');
    setShowAuthModal(true);
  };

  const openNotionModal = () => {
    if (!isAccountBound) {
      openLoginModal();
      return;
    }
    setAuthModalMode('notion');
    setShowAuthModal(true);
  };

  const openGitHubModal = () => {
    if (!isAccountBound) {
      openLoginModal();
      return;
    }
    setAuthModalMode('github');
    setShowAuthModal(true);
  };

  const openGoogleModal = () => {
    if (!isAccountBound) {
      openLoginModal();
      return;
    }
    setAuthModalMode('google');
    setShowAuthModal(true);
  };

  const closeAuthModal = () => {
    setShowAuthModal(false);
    setShowApiKeyLogin(false);
    setAuthModalMode('login');
  };

  const toggleNotionMcp = () => {
    if (notionMcpOn) {
      setActiveMcpIds((prev) => prev.filter((id) => id !== 'notion'));
      return;
    }
    if (!isAccountBound || !notionStatus?.connected) {
      openNotionModal();
      return;
    }
    setActiveMcpIds((prev) => (prev.includes('notion') ? prev : [...prev, 'notion']));
  };

  const setNotionMcpEnabled = (enabled: boolean) => {
    if (!enabled) {
      setActiveMcpIds((prev) => prev.filter((id) => id !== 'notion'));
      return;
    }
    if (!isAccountBound || !notionStatus?.connected) {
      openNotionModal();
      return;
    }
    setActiveMcpIds((prev) => (prev.includes('notion') ? prev : [...prev, 'notion']));
  };

  const setGitHubMcpEnabled = (enabled: boolean) => {
    if (!enabled) {
      setActiveMcpIds((prev) => prev.filter((id) => id !== 'github'));
      return;
    }
    if (!isAccountBound || !githubStatus?.connected) {
      openGitHubModal();
      return;
    }
    setActiveMcpIds((prev) => (prev.includes('github') ? prev : [...prev, 'github']));
  };

  const setGoogleServiceEnabled = (
    service: 'gmail' | 'calendar' | 'drive',
    enabled: boolean,
  ) => {
    if (!enabled) {
      setActiveMcpIds((prev) => prev.filter((id) => id !== service && id !== 'google'));
      return;
    }
    if (!isAccountBound || !googleStatus?.connected) {
      openGoogleModal();
      return;
    }
    setActiveMcpIds((prev) => {
      const withoutLegacy = prev.filter((id) => id !== 'google');
      return withoutLegacy.includes(service) ? withoutLegacy : [...withoutLegacy, service];
    });
  };

  const lastMessage = messages[messages.length - 1];
  const truncationInfo = useMemo(() => {
    const withShort = (info: { truncated: boolean; reason: string }) => ({
      ...info,
      // Backend research quality-gate errors are `;`-joined multi-clause
      // strings — too long/technical for an inline pill. Full text stays
      // available via the `title` tooltip; this is only for the label.
      shortReason: info.reason ? shortenTruncationReason(info.reason) : '',
    });
    if (!lastMessage || lastMessage.role !== 'assistant') {
      return withShort({ truncated: false, reason: '' });
    }
    // Finished Deep Research reports are complete — never offer Continue.
    if (lastMessage.research?.jobId && String(lastMessage.content || '').trim()) {
      const researchDone = lastMessage.research.status === 'done';
      const hasResearchFile = (lastMessage.files || []).some(
        (f) =>
          String(f.name || '').startsWith('research_') ||
          String(f.url || '').includes('/api/files/') ||
          String(f.url || '').startsWith('local://local_research_') ||
          String(f.url || '').startsWith('local://research'),
      );
      if (researchDone || hasResearchFile) {
        return withShort({ truncated: false, reason: '' });
      }
    }
    // Failed requests need Retry, not Continue-from-partial.
    if (isAssistantError(lastMessage)) {
      return withShort({ truncated: false, reason: '' });
    }
    // Refresh / navigate away mid-stream often leaves an empty incomplete bubble
    // (Process was spinning, no answer token yet). Offer Continue to re-run.
    if (lastMessage.incomplete && !String(lastMessage.content || '').trim()) {
      return withShort({
        truncated: true,
        reason: lastMessage.truncationReason || 'Reply was interrupted',
      });
    }
    if (!lastMessage.content?.trim()) {
      return withShort({ truncated: false, reason: '' });
    }
    const toolsOk = hasSuccessfulRetrievalTools(lastMessage.toolRuns);
    const base = analyzeTruncation(
      lastMessage.content,
      lastMessage.finishReason,
      lastMessage.incomplete,
      // Ignore stale intent-stop stamp once retrieval tools have succeeded.
      toolsOk && lastMessage.truncationReason === 'Stopped before calling tools'
        ? undefined
        : lastMessage.truncationReason,
    );
    // Mid-turn often leaves the bubble ending on "我先去读…" even after tools
    // already ran — don't keep offering Continue / "Stopped before calling tools".
    if (base.truncated && base.reason === 'Stopped before calling tools' && toolsOk) {
      return withShort({ truncated: false, reason: '' });
    }
    if (base.truncated) return withShort(base);

    // Tool failed and the model never finished a recovery answer — common when
    // Notion/GitHub writes error mid-turn and the body dies on a heading.
    const failedTools = (lastMessage.toolRuns || []).some(
      (r) => r.status === 'done' && Boolean(r.error),
    );
    if (failedTools) {
      const abrupt = looksAbruptlyCutOff(lastMessage.content);
      if (abrupt.truncated) return withShort(abrupt);
      const body = lastMessage.content.trim();
      // Short narration after a failed write, without acknowledging the error.
      if (
        body.length < 500 &&
        !/(失败|错误|无法|error|failed|invalid|page_id|缺少|参数)/i.test(body)
      ) {
        return withShort({ truncated: true, reason: 'Stopped after a tool error' });
      }
    }
    return withShort(base);
  }, [lastMessage]);
  const NEAR_BOTTOM_PX = 96;

  const isNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
  };

  const scrollToBottom = (force = false) => {
    const el = scrollRef.current;
    if (!el) return;
    if (!force && !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  };

  const handleMessagesScroll = () => {
    stickToBottomRef.current = isNearBottom();
  };


  // --- Actions ---
  const updateSession = (sessionId: string, newMessages: Message[], title?: string) => {
    // Apply against sessionsRef immediately so same-tick readers (handleSubmit →
    // streamChatResponse / queue) see truncated history + rebuilt Material.
    // Waiting for the setState updater alone is too late: React batches, and the
    // render-time `sessionsRef.current = sessions` assignment can briefly keep
    // the pre-edit snapshot — which re-injected old web_search hits as referenceText.
    const prev = sessionsRef.current;
    const exists = prev.some((s) => s.id === sessionId);
    let next: ChatSession[];
    if (!exists) {
      const created: ChatSession = {
        id: sessionId || crypto.randomUUID(),
        title: title || 'New Conversation',
        messages: newMessages,
        updatedAt: Date.now(),
        webSources: collectWebSourcesFromMessages(newMessages),
      };
      if (!sessionId) setActiveSessionId(created.id);
      next = [created, ...prev.filter((s) => s.messages.length > 0)];
    } else {
      next = prev.map((s) => {
        if (s.id !== sessionId) return s;
        return {
          ...s,
          messages: newMessages,
          title: title || s.title,
          updatedAt: Date.now(),
          webSources: webSourcesForThread(newMessages, s),
        };
      });
    }
    sessionsRef.current = next;
    setSessions(next);
  };

  const updateActiveSession = (newMessages: Message[], title?: string) => {
    updateSession(activeSessionId, newMessages, title);
  };

  const clearWebSources = () => {
    setWebSourcesCleared(true);
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.id === activeSessionId
          ? { ...s, webSources: undefined, webSourcesCleared: true }
          : s,
      );
      sessionsRef.current = next;
      return next;
    });
    setConfirmClearSourcesOpen(false);
  };

  const markAssistantIncomplete = (
    sessionId: string,
    assistantId: string,
    incomplete: boolean,
    meta?: { finishReason?: string | null; truncationReason?: string },
  ) => {
    setSessions((prev) =>
      withMarkedAssistantIncomplete(prev, sessionId, assistantId, incomplete, meta),
    );
  };

  const streamChatResponse = async (
    sessionId: string,
    apiMessages: ReturnType<typeof toApiMessages>,
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
    requestOpts?: import('@/lib/chat/stream/client').StreamChatRequestOpts,
  ) =>
    runStreamChatResponse(
      {
        getSessions: () => sessionsRef.current,
        setSessions,
        selectedModel,
        systemPrompt,
        skillsPayloadForSession,
        memoriesPayload,
        getNotionConnected: () => Boolean(notionStatusRef.current?.connected),
        getGitHubConnected: () => Boolean(githubStatusRef.current?.connected),
        getGoogleConnected: () => Boolean(googleStatusRef.current?.connected),
        getActiveSessionId: () => activeSessionIdRef.current,
        scrollToBottom,
        fetchSkills,
        onGeneratedFileForActiveSession: () => {
          setPicturesExpanded(true);
          setOutputGroupsOpen((prev) => ({ ...prev, files: true }));
          setIsContextPanelOpen(true);
        },
        onWebSourcesUpdated: ({ openContextPanel, unsetWebSourcesCleared }) => {
          if (unsetWebSourcesCleared) setWebSourcesCleared(false);
          if (openContextPanel) queueMicrotask(() => setIsContextPanelOpen(true));
        },
        onReplySettled: onMemoryReplySettled,
        onGoogleAuthRequired: () => {
          setAttachError(
            'Google tools are enabled but not authorized — reconnect Google in Settings, then try again.',
          );
        },
        onNotionAuthRequired: () => {
          setAttachError(
            'Notion is enabled but not authorized — reconnect Notion in Settings, then try again.',
          );
        },
        onGitHubAuthRequired: () => {
          setAttachError(
            'GitHub is enabled but not authorized — reconnect GitHub in Settings, then try again.',
          );
        },
        onMalformedSse: (message) => {
          setAttachError(message);
        },
      },
      sessionId,
      apiMessages,
      assistantId,
      signal,
      initialContent,
      seamPrefix,
      webSourcesOverride,
      requestReview,
      requestOpts,
    );

  const deleteSession = (id: string) => {
    const controller = abortControllersRef.current.get(id);
    if (controller) controller.abort();
    clearSessionWork(id);
    // Delete cloud copy too, or the next cross-device merge would resurrect it.
    if (isAccountBound) {
      void fetch(`/api/sync/sessions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }).catch(() => {
        // Portal down: deletion stays local until a future sync window.
      });
    }
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id && s.messages.length > 0);

      if (filtered.length === 0) {
        const emptyDraft: ChatSession = {
          id: crypto.randomUUID(),
          title: 'New Conversation',
          messages: [],
          updatedAt: Date.now(),
        };
        setActiveSessionId(emptyDraft.id);
        return [emptyDraft];
      }

      if (activeSessionId === id) {
        // After deleting the active chat, return to a blank New Chat draft.
        const emptyDraft: ChatSession = {
          id: crypto.randomUUID(),
          title: 'New Conversation',
          messages: [],
          updatedAt: Date.now(),
        };
        setActiveSessionId(emptyDraft.id);
        return [emptyDraft, ...filtered];
      }

      return filtered;
    });
    setSessionPendingDelete(null);
  };

  const saveUserKey = async () => {
    const trimmed = tempKeyInput.trim();
    setAccountError('');
    setAccountSaving(true);
    try {
      await bindWithApiKey(trimmed);
      setTempKeyInput('');
      closeAuthModal();
      await fetchModels();
      await fetchSkills();
      await fetchMemories();
      await fetchIntegrations();
    } catch (error: any) {
      setAccountError(error?.message || '绑定失败');
    } finally {
      setAccountSaving(false);
    }
  };

  const disconnectAccount = async () => {
    await disconnectAccountCore();
    setTempKeyInput('');
    setActiveMcpIds((prev) => prev.filter((id) => id !== 'zhipu-vision'));
    closeAuthModal();
    setNotionStatus(null);
    setGitHubStatus(null);
    setGoogleStatus(null);
    setSessions([]);
    setSkills([]);
    setMemories([]);
    clearLocalSessions();
    createNewSession();
    await fetchModels();
  };

  const selectedSpec = useMemo(() => {
    const fromList = availableModels.find((m) => m.id === selectedModel);
    const fallback = getModelSpec(selectedModel);
    return {
      context: fromList?.context_window ?? fallback.context,
      maxOutput: fromList?.max_output ?? fallback.maxOutput,
      // Prefer explicit list flag; fall back to local specs so we don't
      // treat vision models as text-only when the API field is missing.
      vision: fromList?.vision ?? fallback.vision,
    };
  }, [availableModels, selectedModel]);

  const hasImages = useMemo(
    () => sessionHasImages(messages, attachments),
    [messages, attachments],
  );
  /** Soft-allow text models with images when Zhipu Vision MCP is on. */
  const imagesBlockTextModel = hasImages && !selectedSpec.vision && !zhipuVisionOn;
  const imagesPreferVision = hasImages && !selectedSpec.vision && zhipuVisionOn;

  // Close model menu on outside click / Escape.
  useEffect(() => {
    if (!isModelMenuOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (modelMenuRef.current && target && !modelMenuRef.current.contains(target)) {
        setIsModelMenuOpen(false);
        setModelSearchQuery('');
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsModelMenuOpen(false);
        setModelSearchQuery('');
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isModelMenuOpen]);

  // Focus search when the model menu opens.
  useEffect(() => {
    if (!isModelMenuOpen) return;
    const timer = window.setTimeout(() => modelSearchRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [isModelMenuOpen]);

  // Keep <html lang> in sync with UI locale.
  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);

  const filteredModels = useMemo(() => {
    const q = modelSearchQuery.trim().toLowerCase();
    if (!q) return availableModels;
    return availableModels.filter((m) => m.id.toLowerCase().includes(q));
  }, [availableModels, modelSearchQuery]);

  // When images appear on a text-only model:
  // - Zhipu Vision MCP off → hard block (must switch to vision)
  // - Zhipu Vision MCP on → soft suggestion (bridge via GLM-4.6V)
  useEffect(() => {
    if (imagesBlockTextModel) {
      setAttachError(t('imagesNeedVision'));
      return;
    }
    if (imagesPreferVision) {
      setAttachError(t('imagesPreferVision'));
      return;
    }
    setAttachError((prev) =>
      prev === t('imagesNeedVision') ||
      prev === t('imagesPreferVision') ||
      prev === 'This conversation has images. Pick a Vision model to continue.' ||
      prev === 'This conversation has images — switch to a vision-capable model.'
        ? ''
        : prev,
    );
  }, [imagesBlockTextModel, imagesPreferVision, t, locale]);

  // When the selected chat model is already Vision-capable, Image Understand
  // would be redundant (and may cause double work). Auto-disable the MCP.
  useEffect(() => {
    if (!selectedSpec.vision) return;
    if (!zhipuVisionOn) return;
    setActiveMcpIds((prev) => prev.filter((id) => id !== 'zhipu-vision'));
  }, [selectedSpec.vision, zhipuVisionOn]);

  // Conversation already has images + switch (or land) on a text-only model:
  // turn Image Understand on immediately so the chat stays usable. Guests still
  // must pick a Vision model (no MCP billing account).
  useEffect(() => {
    if (!isAccountBound) return;
    if (selectedSpec.vision) return;
    if (!hasImages) return;
    if (zhipuVisionOn) return;
    setActiveMcpIds((prev) =>
      prev.includes('zhipu-vision') ? prev : [...prev, 'zhipu-vision'],
    );
  }, [isAccountBound, selectedSpec.vision, hasImages, zhipuVisionOn]);

  // Token estimate aligned with what the server actually sends.
  const contextBreakdown = useMemo(() => {
    const systemText = (systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT);
    const system = estimateTokensFromText(systemText);
    const skillTokens = activeSkills.reduce(
      (sum, s) => sum + estimateTokensFromText(`${s.title}\n${s.content}`) + 8,
      0,
    );
    const reference = estimateTokensFromText(formatWebSourcesForReference(webSources));
    const files = estimateTokensFromText(
      attachments
        .filter((a) => a.text)
        .map((a) => `${a.name}\n${a.text}`)
        .join('\n\n'),
    );
    // Images are roughly ~1k tokens each for budgeting (provider-dependent).
    const imageTokens =
      attachments.filter((a) => a.dataUrl).length * 1000 +
      messages.reduce((sum, m) => sum + (m.images?.length || 0) * 1000, 0);
    const conversation = messages.reduce(
      (sum, m) => sum + estimateTokensFromText(messagePlainText(m)) + 4,
      0,
    );
    return {
      system,
      skills: skillTokens,
      reference,
      files,
      images: imageTokens,
      conversation,
      total: system + skillTokens + reference + files + imageTokens + conversation,
    };
  }, [messages, systemPrompt, webSources, attachments, activeSkills]);

  const estimatedTokens = contextBreakdown.total;
  const contextLimit = selectedSpec.context;
  const outputReserve = Math.min(selectedSpec.maxOutput || 8192, 8192);
  const usableLimit =
    contextLimit != null ? Math.max(contextLimit - outputReserve, 1) : null;
  const {
    enqueueOrSubmit,
    cancelQueuedMessage,
    clearQueue,
    resumeQueue,
    jumpQueueAndSubmit,
    runCompact,
    resumeIncompleteReply,
    requestClaimReview,
    retryFailedReply,
    editUserMessage,
    cancelEditMessage,
    saveEditedMessage,
    runLiteratureSearch,
    runBookDownload,
    stopGenerating,
    handleSubmit,
    loadingBySession,
    isSessionLoading,
    isActiveLoading,
    beginLoading,
    endLoading,
    activeQueue,
    queuePaused,
    isCompacting,
    compactNotice,
    clearSessionWork,
  } = useChatLogic({
    activeSessionId,
    sessionsRef,
    activeSessionIdRef,
    abortControllersRef,
    updateSession,
    setSessions,
    markAssistantIncomplete,
    streamChatResponse,
    input,
    setInput,
    quotedSelections,
    setQuotedSelections,
    attachments,
    setAttachments,
    setAttachError,
    isAccountBound,
    openLoginModal,
    stickToBottomRef,
    scrollToBottom,
    setIsSkillPickerOpen,
    selectedSpec,
    selectedModel,
    zhipuVisionOn,
    usableLimit,
    contextBreakdown,
    setPicturesExpanded,
    setOutputGroupsOpen,
    setIsContextPanelOpen,
    editingMessageContent,
    setEditingMessageContent,
    editingMessageAttachments,
    setEditingMessageAttachments,
    setEditingMessageId,
    messages,
    messageImagesToIngested,
  });

  const deepResearch = useDeepResearch({
    setSessions,
    beginLoading,
    endLoading,
  });

  const researchReattachAttemptsRef = useRef(new Map<string, number>());
  const researchReattachInFlightRef = useRef(new Set<string>());
  const researchReattachRef = useRef(deepResearch.reattach);
  researchReattachRef.current = deepResearch.reattach;
  // After refresh or switching sessions, reconnect SSE for in-flight Deep Research.
  // Depend on busy/activeSessionId only — not the whole deepResearch object (new each render).
  useEffect(() => {
    if (!chatsHydrated) return;
    if (deepResearch.busy) return;
    const session = sessionsRef.current.find((s) => s.id === activeSessionId);
    if (!session) return;
    const running = session.messages.find((m) => {
      if (m.role !== 'assistant' || !m.research?.jobId) return false;
      return ['queued', 'planning', 'searching', 'synthesizing', 'verifying', 'writing'].includes(
        String(m.research.status || ''),
      );
    });
    const jobId = running?.research?.jobId;
    if (!jobId || !running) return;
    if (researchReattachInFlightRef.current.has(jobId)) return;
    const MAX_PAGE_REATTACH = 3;
    const attempts = researchReattachAttemptsRef.current.get(jobId) || 0;
    if (attempts >= MAX_PAGE_REATTACH) return;
    researchReattachInFlightRef.current.add(jobId);
    researchReattachAttemptsRef.current.set(jobId, attempts + 1);
    void Promise.resolve(
      researchReattachRef.current({
        jobId,
        sessionId: session.id,
        assistantId: running.id,
        query: running.research?.query || '',
        mode: (running.research?.mode as 'quick' | 'standard' | 'rigorous') || 'standard',
      }),
    ).finally(() => {
      researchReattachInFlightRef.current.delete(jobId);
    });
  }, [chatsHydrated, deepResearch.busy, activeSessionId]);

  const startResearchTurn = useCallback(
    async (opts: {
      query: string;
      sessionId: string;
      assistantId?: string;
      /** When set, truncate session messages to this prefix before appending user+assistant. */
      priorMessages?: Message[];
      userContent?: string;
      mode?: ResearchModeHint;
      sources?: ResearchSourcesHint;
    }) => {
      if (!isAccountBound) {
        openLoginModal();
        return;
      }
      const sid = opts.sessionId;
      const q = opts.query.trim();
      if (!q) return;
      const now = Date.now();
      const mode = opts.mode || deepResearch.mode;
      // Only echo the depth token when the user explicitly chose one.
      const userContent = opts.userContent || formatResearchCommand(q, opts.mode, opts.sources);
      const userMsg: Message = {
        id: `research_user_${now}`,
        role: 'user',
        content: userContent,
        timestamp: now,
      };

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sid) return s;
          const base =
            opts.priorMessages != null
              ? opts.priorMessages
              : opts.assistantId
                ? s.messages.filter((m) => m.id !== opts.assistantId)
                : s.messages;
          return {
            ...s,
            updatedAt: now,
            title:
              !s.title || s.title === 'New Chat'
                ? `研究: ${q.slice(0, 40)}`
                : s.title,
            messages: [...base, userMsg],
          };
        }),
      );

      await deepResearch.start({
        query: q,
        mode,
        sources: opts.sources,
        sessionId: sid,
        model: selectedModel || undefined,
        assistantId: opts.assistantId,
      });
    },
    [deepResearch, isAccountBound, openLoginModal, selectedModel, setSessions],
  );

  const submitComposer = useCallback(() => {
    const researchCmd = parseResearchCommand(input);
    if (researchCmd) {
      setInput('');
      void startResearchTurn({
        query: researchCmd.query,
        mode: researchCmd.mode,
        sources: researchCmd.sources,
        sessionId: activeSessionId,
      });
      return;
    }
    const reviewCmd = parseReviewCommand(input);
    if (reviewCmd) {
      if (!isAccountBound) {
        openLoginModal();
        return;
      }
      const userContent = input.trim();
      setInput('');
      void requestClaimReview({
        focus: reviewCmd.focus,
        userContent,
      });
      return;
    }
    enqueueOrSubmit();
  }, [
    input,
    setInput,
    startResearchTurn,
    activeSessionId,
    enqueueOrSubmit,
    isAccountBound,
    openLoginModal,
    requestClaimReview,
  ]);

  const stopOrCancel = useCallback(() => {
    if (deepResearch.busy) {
      void deepResearch.cancel();
      return;
    }
    stopGenerating();
  }, [deepResearch, stopGenerating]);

  const resumeIncompleteOrResearch = useCallback(
    async (opts?: { force?: boolean }) => {
      const sessionId = activeSessionId;
      const sessionMessages =
        sessionsRef.current.find((s) => s.id === sessionId)?.messages || [];
      const last = sessionMessages[sessionMessages.length - 1];
      const researchJobId = last?.research?.jobId;
      const researchStatus = String(last?.research?.status || '');
      const researchNeedsContinue =
        last?.role === 'assistant' &&
        Boolean(researchJobId) &&
        (Boolean(last.incomplete) ||
          Boolean(last.truncationReason) ||
          researchStatus === 'failed' ||
          researchStatus === 'cancelled' ||
          (researchStatus !== 'done' && researchStatus !== ''));
      if (researchNeedsContinue && researchJobId) {
        if (deepResearch.busy) return;
        const lastUserContent =
          [...sessionMessages].reverse().find((m) => m.role === 'user')?.content || '';
        const q =
          String(last.research?.query || '').trim() ||
          parseResearchCommand(lastUserContent)?.query ||
          '';
        if (!q) {
          // Surface why Continue did nothing — missing query blocks resume.
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sessionId) return s;
              return {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === last.id
                    ? {
                        ...m,
                        incomplete: true,
                        truncationReason:
                          'Missing research query — re-run /research with your question',
                      }
                    : m,
                ),
              };
            }),
          );
          return;
        }
        const mode =
          (last.research?.mode as ResearchModeHint | undefined) || deepResearch.mode;
        await deepResearch.resume({
          jobId: researchJobId,
          sessionId,
          assistantId: last.id,
          query: q,
          mode,
        });
        return;
      }
      await resumeIncompleteReply({ force: true, ...opts });
    },
    [activeSessionId, deepResearch, resumeIncompleteReply, setSessions],
  );

  const saveEditedMessageOrResearch = useCallback(
    async (messageId: string) => {
      const content = editingMessageContent.trim();
      const researchCmd = parseResearchCommand(content);
      if (researchCmd) {
        if (isActiveLoading || deepResearch.busy) {
          stopOrCancel();
        }
        const sessionMsgs =
          sessionsRef.current.find((s) => s.id === activeSessionId)?.messages ||
          messages;
        const index = sessionMsgs.findIndex((m) => m.id === messageId);
        if (index < 0) return;
        const priorMessages = sessionMsgs.slice(0, index);
        setEditingMessageId(null);
        setEditingMessageContent('');
        setEditingMessageAttachments([]);
        await startResearchTurn({
          query: researchCmd.query,
          mode: researchCmd.mode,
          sources: researchCmd.sources,
          sessionId: activeSessionId,
          priorMessages,
          userContent: content,
        });
        return;
      }
      const reviewCmd = parseReviewCommand(content);
      if (reviewCmd) {
        if (isActiveLoading || deepResearch.busy) {
          stopOrCancel();
        }
        const sessionMsgs =
          sessionsRef.current.find((s) => s.id === activeSessionId)?.messages ||
          messages;
        const index = sessionMsgs.findIndex((m) => m.id === messageId);
        if (index < 0) return;
        // Truncate to before this message so review targets the prior assistant.
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId
              ? {
                  ...s,
                  updatedAt: Date.now(),
                  messages: sessionMsgs.slice(0, index),
                }
              : s,
          ),
        );
        setEditingMessageId(null);
        setEditingMessageContent('');
        setEditingMessageAttachments([]);
        await requestClaimReview({
          focus: reviewCmd.focus,
          userContent: content,
        });
        return;
      }

      // Same as composer: edit/resend of /papers|/books must not fall through to chat.
      const literatureCmd = parseLiteratureCommand(content);
      if (literatureCmd) {
        if (isActiveLoading || deepResearch.busy) {
          stopOrCancel();
        }
        const sessionMsgs =
          sessionsRef.current.find((s) => s.id === activeSessionId)?.messages ||
          messages;
        const index = sessionMsgs.findIndex((m) => m.id === messageId);
        if (index < 0) return;
        const priorMessages = sessionMsgs.slice(0, index);
        setEditingMessageId(null);
        setEditingMessageContent('');
        setEditingMessageAttachments([]);
        if (literatureCmd.action === 'download') {
          await runBookDownload(literatureCmd.identifier, {
            sessionId: activeSessionId,
            baseMessages: priorMessages,
          });
          return;
        }
        await runLiteratureSearch(literatureCmd.kind, literatureCmd.query, {
          sessionId: activeSessionId,
          baseMessages: priorMessages,
          source: 'source' in literatureCmd ? literatureCmd.source : undefined,
          action: literatureCmd.action || 'search',
          paperId:
            literatureCmd.kind === 'papers' && 'paperId' in literatureCmd
              ? literatureCmd.paperId
              : undefined,
        });
        return;
      }

      await saveEditedMessage(messageId);
    },
    [
      editingMessageContent,
      isActiveLoading,
      deepResearch.busy,
      stopOrCancel,
      activeSessionId,
      messages,
      startResearchTurn,
      saveEditedMessage,
      requestClaimReview,
      runLiteratureSearch,
      runBookDownload,
      setSessions,
      setEditingMessageId,
      setEditingMessageContent,
      setEditingMessageAttachments,
    ],
  );

  const {
    slashMenuItems,
    slashHighlight,
    setSlashHighlight,
    consumeSlashItem,
  } = useChatSlash({
    input,
    setInput,
    skills,
    isAccountBound,
    setActiveSkillIds,
    setIsSkillPickerOpen,
    openLoginModal,
    attachSkill,
    t,
  });

  // Only offer Continue when we have a clear interruption signal — not for every
  // finished assistant turn. Deep Research failures also set incomplete + truncationReason.
  const canResumeIncomplete =
    !isActiveLoading && !deepResearch.busy && truncationInfo.truncated;
  // Timeout / upstream failures leave an Error: bubble — offer Retry for that turn.
  const canRetryFailed =
    !isActiveLoading && !deepResearch.busy && isAssistantError(lastMessage);

  // After refresh / remount / lost tool-done events, orphan tool runs can stay at
  // status:"start" and spin forever. Close them whenever the session is idle.
  // Skip while Deep Research is in flight — its tools stay "start" across long LLM calls.
  useEffect(() => {
    if (!chatsHydrated) return;
    if (deepResearch.busy) return;
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (loadingBySession[s.id]) return s;
        let sessionChanged = false;
        const messages = s.messages.map((m) => {
          if (m.role !== 'assistant') return m;
          // Do not require m.incomplete: the SSE-drop reattach path clears the
          // flag while the job keeps running; a refresh in that window must not
          // stamp the still-running research tools as interrupted.
          const researchActive =
            Boolean(m.research?.jobId) &&
            !['done', 'failed', 'cancelled'].includes(String(m.research?.status || ''));
          if (researchActive) return m;
          const toolsNeedClose = (m.toolRuns || []).some((r) => r.status === 'start');
          const needsInterruptStamp = m.incomplete && !m.truncationReason;
          if (!toolsNeedClose && !needsInterruptStamp) return m;
          sessionChanged = true;
          changed = true;
          return {
            ...m,
            truncationReason: needsInterruptStamp
              ? m.truncationReason || 'Reply was interrupted'
              : m.truncationReason,
            toolRuns: (m.toolRuns || []).map((r) =>
              r.status === 'start'
                ? {
                    ...r,
                    status: 'done' as const,
                    error: r.error || 'Interrupted before results arrived',
                  }
                : r,
            ),
          };
        });
        return sessionChanged ? { ...s, messages } : s;
      });
      return changed ? next : prev;
    });
  }, [chatsHydrated, loadingBySession, deepResearch.busy]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isActiveLoading]);

  // Switching conversations should land at the latest message.
  // Clear the previewed file only when the session id actually changes — same-session
  // sends / session array identity churn must not wipe an open Preview.
  // Keep the Preview panel open/closed as a layout preference (same as Context).
  const lastPreviewSessionIdRef = useRef(activeSessionId);
  useEffect(() => {
    stickToBottomRef.current = true;
    scrollToBottom(true);
    if (lastPreviewSessionIdRef.current === activeSessionId) return;
    lastPreviewSessionIdRef.current = activeSessionId;
    setPreviewFileEntry(null);
  }, [activeSessionId]);

  // Keep / drop the side-panel preview against the live Output file list:
  // deleted → clear; same id with updated content/name/size → refresh snapshot.
  useEffect(() => {
    if (!previewFileEntry) return;
    const latest = generatedFileHistory.find(
      (f) => f.id === previewFileEntry.id && f.messageId === previewFileEntry.messageId,
    );
    if (!latest) {
      setPreviewFileEntry(null);
      return;
    }
    if (
      latest.content !== previewFileEntry.content ||
      latest.name !== previewFileEntry.name ||
      latest.size !== previewFileEntry.size ||
      latest.url !== previewFileEntry.url ||
      latest.mimeType !== previewFileEntry.mimeType
    ) {
      setPreviewFileEntry(latest);
    }
  }, [generatedFileHistory, previewFileEntry]);

  // While the assistant turn is still open but the stream has gone idle (no new
  // content / thought / tool), show a textless spinner under the bubble — including
  // the common gap after narration and before the next tool_call token.
  useEffect(() => {
    if (!isActiveLoading || !activeSessionId) {
      setReplyWaitByMessage({});
      return;
    }
    const session = sessionsRef.current.find((s) => s.id === activeSessionId);
    const msg = session?.messages[session.messages.length - 1];
    if (!msg || msg.role !== 'assistant' || !msg.incomplete) {
      setReplyWaitByMessage({});
      return;
    }
    const toolPending = (msg.toolRuns || []).some((r) => r.status === 'start');
    if (toolPending) {
      setReplyWaitByMessage((prev) => {
        if (!prev[msg.id]) return prev;
        const next = { ...prev };
        delete next[msg.id];
        return next;
      });
      return;
    }
    setReplyWaitByMessage((prev) => {
      if (!prev[msg.id]) return prev;
      const next = { ...prev };
      delete next[msg.id];
      return next;
    });
    // Mid-answer token gaps are often 1–2s; only treat longer stalls as a "wait"
    // (e.g. tool round). First-token wait uses awaitingFirstContent and does not
    // depend on this timer.
    const hasVisibleOutput =
      Boolean(String(msg.content || '').trim()) ||
      (msg.activity || []).some(
        (s) => s.kind === 'reasoning' && String(s.text || '').trim(),
      ) ||
      Boolean(String(msg.reasoning || '').trim());
    const idleMs = hasVisibleOutput ? 2800 : 500;
    const timer = window.setTimeout(() => {
      setReplyWaitByMessage((prev) =>
        prev[msg.id] ? prev : { ...prev, [msg.id]: true },
      );
    }, idleMs);
    return () => window.clearTimeout(timer);
  }, [
    isActiveLoading,
    activeSessionId,
    sessions
      .find((s) => s.id === activeSessionId)
      ?.messages.filter((m) => m.role === 'assistant')
      .slice(-1)
      .map((m) => {
        const tools = (m.toolRuns || [])
          .map((r) => `${r.id}:${r.status}`)
          .join(',');
        return `${m.id}:${m.content?.length || 0}:${m.reasoning?.length || 0}:${(m.activity || []).length}:${tools}`;
      })
      .join('|'),
  ]);

  const usageRatio =
    usableLimit != null ? Math.min(estimatedTokens / usableLimit, 1.5) : null;

  const contextSources = useMemo(
    () =>
      (
        [
          ['System', contextBreakdown.system],
          ['Skills', contextBreakdown.skills],
          ['Reference', contextBreakdown.reference],
          ['Files', contextBreakdown.files],
          ['Images', contextBreakdown.images],
          ['Conversation', contextBreakdown.conversation],
        ] as Array<[string, number]>
      ).filter(([, tokens]) => tokens > 0),
    [contextBreakdown],
  );

  // Remember the user's model choice across refreshes.
  useEffect(() => {
    if (!selectedModel) return;
    localStorage.setItem('llm_christmas_selected_model', selectedModel);
  }, [selectedModel]);

  // Close skill picker on outside click.
  useEffect(() => {
    if (!isSkillPickerOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (skillPickerRef.current && target && !skillPickerRef.current.contains(target)) {
        setIsSkillPickerOpen(false);
        setPlusFlyout(null);
        plusMenuButtonRef.current?.blur();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [isSkillPickerOpen]);

  const quoteSelectedText = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setQuotedSelections((prev) => appendQuotedSelection(prev, clean));
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const removeQuotedSelection = (index: number) => {
    setQuotedSelections((prev) => prev.filter((_, i) => i !== index));
  };

  const skillsPayloadForSession = (sessionId: string) => {
    const ids = sessionsRef.current.find((s) => s.id === sessionId)?.skillIds || [];
    return ids
      .map((id) => {
        const builtin = BUILTIN_SKILLS.find((b) => b.id === id);
        if (builtin) return builtin;
        return skillsRef.current.find((s) => s.id === id);
      })
      .filter((s): s is { id: string; title: string; content: string } => Boolean(s))
      .map((s) => ({ id: s.id, title: s.title, content: s.content }));
  };


  const exportChat = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const session = sessions.find((s) => s.id === id);
    if (!session) return;
    const md = session.messages.map(m => `### ${m.role === 'user' ? 'User' : 'Assistant'}\n\n${m.content}\n`).join('\n---\n\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.title}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (slashMenuItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashHighlight((i) => (i + 1) % slashMenuItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashHighlight((i) => (i - 1 + slashMenuItems.length) % slashMenuItems.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        if (isEnterSubmitBlockedByIme(e, composerImeComposingRef, composerImeEnterLockRef)) {
          return;
        }
        e.preventDefault();
        const pick = slashMenuItems[slashHighlight] || slashMenuItems[0];
        if (pick) consumeSlashItem(pick);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        // Dismiss the menu without wiping the typed command.
        setInput((prev) =>
          prev.replace(/(?:^|\n)\/([^\n]*)$/, (seg, body: string) => {
            const prefix = seg.startsWith('\n') ? '\n' : '';
            return `${prefix}/${body}${body.endsWith(' ') ? '' : ' '}`;
          }),
        );
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const pick = slashMenuItems[slashHighlight] || slashMenuItems[0];
        if (pick) consumeSlashItem(pick);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      if (isEnterSubmitBlockedByIme(e, composerImeComposingRef, composerImeEnterLockRef)) {
        return;
      }
      e.preventDefault();
      // Prevent holding down Enter to spawn dozens of identical tasks
      if (e.repeat) return;
      submitComposer();
    }
  };

  const handleEditMessageKeyDown = (e: React.KeyboardEvent, messageId: string) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isEnterSubmitBlockedByIme(e, editImeComposingRef, editImeEnterLockRef)) {
        return;
      }
      e.preventDefault();
      if (e.repeat) return;
      void saveEditedMessageOrResearch(messageId);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditMessage();
    }
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    if (e.dataTransfer.types.includes('Files')) setIsDraggingFiles(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const onDropFiles = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    if (e.dataTransfer.files?.length) {
      await addIngestedFiles(e.dataTransfer.files);
    }
  };
  const onPasteFiles = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    await addIngestedFiles(files);
  };

  const onPasteEditFiles = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    await addEditIngestedFiles(files);
  };

  return (
    <div
      className="relative flex h-screen w-full bg-[#F9F8F6] font-sans text-stone-800 dark:bg-stone-950 dark:text-stone-200 overflow-hidden"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDropFiles}
    >
      {isDraggingFiles && (
        <div className="pointer-events-none absolute inset-0 z-[60] flex items-center justify-center bg-orange-500/10 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-orange-400 bg-white/90 px-8 py-6 text-center shadow-lg dark:bg-stone-900/90">
            <div className="text-sm font-semibold text-orange-700 dark:text-orange-300">Drop to attach</div>
            <div className="mt-1 text-xs text-stone-500">Images, PDF, Word, or text files</div>
          </div>
        </div>
      )}

      <ChatSidebar
        open={isSidebarOpen}
        sessions={sessions}
        activeSessionId={activeSessionId}
        isSessionLoading={isSessionLoading}
        skills={skills}
        activeSkillIds={activeSkillIds}
        autoReviewEnabled={activeAutoReview}
        modelSupportsVision={Boolean(selectedSpec?.vision)}
        isAccountBound={isAccountBound}
        accountDisplayName={
          isAccountBound
            ? accountUsername || t('accountConnected')
            : t('connectAccount')
        }
        canContinue={canResumeIncomplete}
        onCreateSession={createNewSession}
        onSelectSession={(sessionId) => {
          setActiveSessionId(sessionId);
          setWebSourcesCleared(false);
          setQuotedSelections([]);
        }}
        onRequestDeleteSession={(id, title) =>
          setSessionPendingDelete({ id, title })
        }
        onExportSession={exportChat}
        onInsertImageCommand={() => {
          setInput('/image ');
          textareaRef.current?.focus();
        }}
        onInsertSkillCommand={() => {
          setInput('/skill ');
          textareaRef.current?.focus();
        }}
        onInsertResearchCommand={() => {
          setInput('/research ');
          textareaRef.current?.focus();
        }}
        onInsertPapersCommand={() => {
          setInput('/papers ');
          textareaRef.current?.focus();
        }}
        onInsertBooksCommand={() => {
          setInput('/books ');
          textareaRef.current?.focus();
        }}
        onRequestClaimReview={() => {
          void requestClaimReview();
        }}
        onContinueReply={() => {
          void resumeIncompleteOrResearch({ force: true });
        }}
        onOpenNewSkillModal={openNewSkillModal}
        onPreviewSkill={openSkillPreview}
        onToggleSkill={toggleSkill}
        onRequestDeleteSkill={requestDeleteSkill}
        onFetchSkills={fetchSkills}
        onFetchIntegrations={() => {
          void fetchIntegrations();
        }}
        onOpenNotionModal={openNotionModal}
        onOpenGitHubModal={openGitHubModal}
        onOpenGoogleModal={openGoogleModal}
        onOpenFilesModal={() => setFilesManagerOpen(true)}
        onOpenMemoriesModal={openMemoriesModal}
        onOpenLoginModal={openLoginModal}
        onSetAutoReview={setActiveAutoReview}
        generateImageEnabled={generateImageEnabled}
        onSetGenerateImage={setGenerateImageEnabled}
        onDisconnectAccount={disconnectAccount}
      />

        {/* --- Main Area: chat column + full-height side panels --- */}
        <div className="flex-1 flex min-w-0 min-h-0 bg-[#F9F8F6] dark:bg-stone-950 h-full overflow-hidden">
          {/* Chat column — header only spans messages/composer */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
            <header className="flex h-14 items-center justify-between px-4 border-b border-stone-200/50 dark:border-stone-800/50 bg-[#F9F8F6] dark:bg-stone-950 z-10 shrink-0">
              <div className="flex items-center gap-3">
                {!isSidebarOpen && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsSidebarOpen(true)}
                    className="text-stone-500 hover:bg-stone-200/50 dark:hover:bg-stone-800/50"
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-0.5">
                {!isPreviewPanelOpen && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsPreviewPanelOpen(true)}
                    title={t('previewPanel')}
                    aria-label={t('previewPanel')}
                    className="h-8 w-8 text-stone-500"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                )}
                {!isContextPanelOpen && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsContextPanelOpen(true)}
                    title={t('context')}
                    aria-label={t('context')}
                    className="h-8 w-8 text-stone-500"
                  >
                    <Layers className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </header>

            <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
              <ChatMessageList
                messages={messages}
                selectedModel={selectedModel}
                isActiveLoading={isActiveLoading || deepResearch.busy}
                lastMessage={lastMessage}
                replyWaitByMessage={replyWaitByMessage}
                scrollRef={scrollRef}
                messagesContentRef={messagesContentRef}
                handleMessagesScroll={handleMessagesScroll}
                handleSubmit={handleSubmit}
                editingMessageId={editingMessageId}
                editingMessageContent={editingMessageContent}
                setEditingMessageContent={setEditingMessageContent}
                editingMessageAttachments={editingMessageAttachments}
                handleEditMessageKeyDown={handleEditMessageKeyDown}
                onPasteEditFiles={onPasteEditFiles}
                bindImeGuards={bindImeGuards}
                editImeComposingRef={editImeComposingRef}
                editImeEnterLockRef={editImeEnterLockRef}
                addEditIngestedFiles={addEditIngestedFiles}
                removeEditingMessageAttachment={removeEditingMessageAttachment}
                setImagePreviewSrc={setImagePreviewSrc}
                onPreviewImage={(entry) => setImagePreviewSrc(entry.url)}
                onPreviewFile={openFilePreview}
                cancelEditMessage={cancelEditMessage}
                saveEditedMessage={saveEditedMessageOrResearch}
                editUserMessage={editUserMessage}
                parseQuotedUserMessage={parseQuotedUserMessage}
                reasoningOpen={reasoningOpen}
                setReasoningOpen={setReasoningOpen}
                toolRunOpen={toolRunOpen}
                setToolRunOpen={setToolRunOpen}
                downloadGeneratedFile={downloadGeneratedFile}
                canRetryFailed={canRetryFailed}
                retryFailedReply={retryFailedReply}
                isAssistantError={isAssistantError}
                memorySavedNotice={
                  memorySavedNotice?.sessionId === activeSessionId
                    ? { count: memorySavedNotice.count }
                    : null
                }
                onViewMemorySaved={() => {
                  dismissMemorySavedNotice();
                  openMemoriesModal();
                }}
                onDismissMemorySaved={dismissMemorySavedNotice}
              />
              <ChatComposer
                activeQueue={activeQueue}
                queueExpanded={queueExpanded}
                setQueueExpanded={setQueueExpanded}
                queuePaused={queuePaused}
                resumeQueue={resumeQueue}
                clearQueue={clearQueue}
                jumpQueueAndSubmit={jumpQueueAndSubmit}
                cancelQueuedMessage={cancelQueuedMessage}
                attachError={attachError}
                compactNotice={compactNotice}
                canResumeIncomplete={canResumeIncomplete}
                truncationInfo={truncationInfo}
                resumeIncompleteReply={resumeIncompleteOrResearch}
                attachments={attachments}
                setImagePreviewSrc={setImagePreviewSrc}
                removeAttachment={removeAttachment}
                activeSkills={activeSkills}
                skillCreatorActive={activeSkillIds.includes(SKILL_CREATOR_ID)}
                dismissSkillCreator={() =>
                  setActiveSkillIds((prev) => prev.filter((id) => id !== SKILL_CREATOR_ID))
                }
                toggleSkill={toggleSkill}
                onPreviewSkill={openSkillPreview}
                quotedSelections={quotedSelections}
                setQuotedSelections={setQuotedSelections}
                removeQuotedSelection={removeQuotedSelection}
                slashMenuItems={slashMenuItems}
                slashHighlight={slashHighlight}
                consumeSlashItem={consumeSlashItem}
                input={input}
                setInput={setInput}
                handleKeyDown={handleKeyDown}
                onPasteFiles={onPasteFiles}
                textareaRef={textareaRef}
                textareaImeProps={bindImeGuards(composerImeComposingRef, composerImeEnterLockRef)}
                modelsLoading={modelsLoading}
                selectedModel={selectedModel}
                isSkillPickerOpen={isSkillPickerOpen}
                setIsSkillPickerOpen={setIsSkillPickerOpen}
                skillPickerRef={skillPickerRef}
                plusMenuButtonRef={plusMenuButtonRef}
                plusFlyout={plusFlyout}
                setPlusFlyout={setPlusFlyout}
                googleMcpMenuOpen={googleMcpMenuOpen}
                setGoogleMcpMenuOpen={setGoogleMcpMenuOpen}
                setIsModelMenuOpen={setIsModelMenuOpen}
                isAccountBound={isAccountBound}
                skills={skills}
                activeSkillIds={activeSkillIds}
                fetchSkills={fetchSkills}
                fetchIntegrations={fetchIntegrations}
                openLoginModal={openLoginModal}
                requestClaimReview={requestClaimReview}
                lastMessage={lastMessage}
                isAssistantError={isAssistantError}
                activeAutoReview={activeAutoReview}
                setActiveAutoReview={setActiveAutoReview}
                generateImageEnabled={generateImageEnabled}
                setGenerateImageEnabled={setGenerateImageEnabled}
                modelSupportsVision={Boolean(selectedSpec?.vision)}
                notionStatus={notionStatus}
                githubStatus={githubStatus}
                googleStatus={googleStatus}
                notionMcpOn={notionMcpOn}
                githubMcpOn={githubMcpOn}
                gmailMcpOn={gmailMcpOn}
                calendarMcpOn={calendarMcpOn}
                driveMcpOn={driveMcpOn}
                setNotionMcpEnabled={setNotionMcpEnabled}
                setGitHubMcpEnabled={setGitHubMcpEnabled}
                setGoogleServiceEnabled={setGoogleServiceEnabled}
                openNotionModal={openNotionModal}
                openGitHubModal={openGitHubModal}
                openGoogleModal={openGoogleModal}
                isModelMenuOpen={isModelMenuOpen}
                modelMenuRef={modelMenuRef}
                modelSearchRef={modelSearchRef}
                modelSearchQuery={modelSearchQuery}
                setModelSearchQuery={setModelSearchQuery}
                availableModels={availableModels}
                filteredModels={filteredModels}
                hasImages={hasImages}
                zhipuVisionOn={zhipuVisionOn}
                setActiveMcpIds={setActiveMcpIds}
                setSelectedModel={setSelectedModel}
                isActiveLoading={isActiveLoading || deepResearch.busy}
                isCompacting={isCompacting}
                stopGenerating={stopOrCancel}
                enqueueOrSubmit={submitComposer}
                researchBusy={deepResearch.busy}
                researchError={deepResearch.error}
                cancelResearch={() => void deepResearch.cancel()}
              />
            </div>
          </div>

          <ChatPreviewPanel
            open={isPreviewPanelOpen}
            onClose={() => setIsPreviewPanelOpen(false)}
            file={previewFileEntry}
            onExpandFullscreen={() => {
              if (!previewFileEntry || typeof previewFileEntry.content !== 'string') return;
              setFilePreview({
                id: previewFileEntry.id,
                name: previewFileEntry.name,
                mimeType: previewFileEntry.mimeType,
                content: previewFileEntry.content,
                size: previewFileEntry.size,
              });
            }}
            onJumpToMessage={() => {
              if (!previewFileEntry) return;
              scrollToMessage(previewFileEntry.messageId);
            }}
            onDownload={() => {
              if (!previewFileEntry) return;
              void downloadGeneratedFile(previewFileEntry);
            }}
          />
          <ChatContextPanel
            open={isContextPanelOpen}
            onClose={() => setIsContextPanelOpen(false)}
            picturesExpanded={picturesExpanded}
            onTogglePicturesExpanded={() => setPicturesExpanded((v) => !v)}
            outputGroupsOpen={outputGroupsOpen}
            onToggleOutputGroup={(key) =>
              setOutputGroupsOpen((prev) => ({ ...prev, [key]: !prev[key] }))
            }
            images={generatedImageHistory}
            files={generatedFileHistory}
            onPreviewImage={(entry) => setImagePreviewSrc(entry.url)}
            onPreviewFile={openFilePreview}
            onScrollToMessage={scrollToMessage}
            onDownloadImage={(entry) => void downloadGeneratedImage(entry)}
            onRemoveImage={removeGeneratedImage}
            onDownloadFile={(entry) => void downloadGeneratedFile(entry)}
            onRemoveFile={removeGeneratedFile}
            referenceExpanded={referenceExpanded}
            onToggleReferenceExpanded={() => setReferenceExpanded((v) => !v)}
            referenceGroupsOpen={referenceGroupsOpen}
            onToggleReferenceGroup={(key) =>
              setReferenceGroupsOpen((prev) => ({ ...prev, [key]: !prev[key] }))
            }
            userUploadReferences={userUploadReferences}
            referenceSourceGroups={referenceSourceGroups}
            webSourcesCount={webSources.length}
            onOpenUploadReference={openUploadReference}
            onRequestClearSources={() => setConfirmClearSourcesOpen(true)}
            systemPromptExpanded={systemPromptExpanded}
            onToggleSystemPromptExpanded={() => setSystemPromptExpanded((v) => !v)}
            systemPrompt={systemPrompt}
            onSystemPromptChange={setSystemPrompt}
            messagesCount={messages.length}
            selectedModel={selectedModel}
            contextLimit={contextLimit}
            usableLimit={usableLimit}
            usageRatio={usageRatio}
            estimatedTokens={estimatedTokens}
            contextSources={contextSources}
            isCompacting={isCompacting}
            canCompact={messages.length >= 4}
            onCompact={async () => {
              const next = await runCompact(messages);
              if (next) updateActiveSession(next);
            }}
          />
        </div>

      <ChatQuoteToolbar
        messagesContentRef={messagesContentRef}
        scrollRef={scrollRef}
        onQuote={quoteSelectedText}
      />

      <FileManagerModal open={filesManagerOpen} onClose={() => setFilesManagerOpen(false)} />

      <MemoryManagerModal
        open={memoriesManagerOpen}
        onClose={closeMemoriesModal}
        memories={memories}
        loading={memoriesLoading}
        saving={memoriesSaving}
        error={memoriesError}
        onRefresh={fetchMemories}
        onUpdate={updateMemory}
        onDelete={deleteMemory}
        onExportMarkdown={exportMarkdown}
        onImportMarkdown={importMarkdown}
      />

      <ChatModals
        confirmClearSourcesOpen={confirmClearSourcesOpen}
        setConfirmClearSourcesOpen={setConfirmClearSourcesOpen}
        clearWebSources={clearWebSources}
        sessionPendingDelete={sessionPendingDelete}
        setSessionPendingDelete={setSessionPendingDelete}
        deleteSession={deleteSession}
        skillPendingDelete={skillPendingDelete}
        setSkillPendingDelete={setSkillPendingDelete}
        isDeletingSkill={isDeletingSkill}
        confirmDeleteSkill={confirmDeleteSkill}
        showSkillModal={showSkillModal}
        setShowSkillModal={setShowSkillModal}
        skillModalMode={skillModalMode}
        skillDraftTitle={skillDraftTitle}
        setSkillDraftTitle={setSkillDraftTitle}
        skillDraftDescription={skillDraftDescription}
        setSkillDraftDescription={setSkillDraftDescription}
        skillDraftContent={skillDraftContent}
        setSkillDraftContent={setSkillDraftContent}
        skillModalError={skillModalError}
        isSavingSkill={isSavingSkill}
        onSaveSkill={() => {
          void createSkill(skillDraftTitle, skillDraftContent, skillDraftDescription);
        }}
        onSwitchToAiSkillCreate={() => {
          setShowSkillModal(false);
          setInput('/skill ');
          textareaRef.current?.focus();
        }}
        showAuthModal={showAuthModal}
        authModalMode={authModalMode}
        closeAuthModal={closeAuthModal}
        isAccountBound={isAccountBound}
        notionStatus={notionStatus}
        githubStatus={githubStatus}
        googleStatus={googleStatus}
        notionBusy={notionBusy}
        githubBusy={githubBusy}
        googleBusy={googleBusy}
        disconnectNotion={disconnectNotion}
        disconnectGitHub={disconnectGitHub}
        disconnectGoogle={disconnectGoogle}
        showApiKeyLogin={showApiKeyLogin}
        setShowApiKeyLogin={setShowApiKeyLogin}
        tempKeyInput={tempKeyInput}
        setTempKeyInput={setTempKeyInput}
        accountError={accountError}
        accountSaving={accountSaving}
        saveUserKey={saveUserKey}
        imagePreviewSrc={imagePreviewSrc}
        setImagePreviewSrc={setImagePreviewSrc}
        filePreview={filePreview}
        setFilePreview={setFilePreview}
        downloadGeneratedFile={downloadGeneratedFile}
      />

    </div>
  );
}
