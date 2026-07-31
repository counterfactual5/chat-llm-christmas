'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Menu,
  PanelRightOpen,
  PanelRightClose,
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
} from '@/lib/chat/references';
import {
  analyzeTruncation,
  hasSuccessfulRetrievalTools,
  looksAbruptlyCutOff,
} from '@/lib/chat/reply-truncation';
import { isAssistantError, messagePlainText } from '@/lib/chat/message-display';
import { useChatLogic } from '@/hooks/use-chat-logic';
import { parseImageCommand } from '@/lib/chat/image-command';
import {
  CHATS_OWNER_KEY,
  mergeSyncedSessions,
  normalizeRestoredSession,
  sessionsForCloudSync,
} from '@/lib/chat/sessions';
import {
  type GeneratedFileEntry,
  type GeneratedImageEntry,
} from '@/components/chat/output-panel';
import { ChatSidebar } from '@/components/chat/sidebar';
import { ChatComposer } from '@/components/chat/composer';
import { ChatMessageList } from '@/components/chat/message-list';
import { ChatContextPanel } from '@/components/chat/context-panel';
import { ChatModals } from '@/components/chat/modals';
import { ChatQuoteToolbar } from '@/components/chat/quote-toolbar';
import {
  appendQuotedSelection,
  parseQuotedUserMessage,
} from '@/lib/chat/quotes';
import {
  messageImagesToIngested,
  sessionHasImages,
  toApiMessages,
} from '@/lib/chat/api-messages';
import { withMarkedAssistantIncomplete } from '@/lib/chat/session-mutations';
import { streamChatResponse as runStreamChatResponse } from '@/lib/chat/stream-response';
import { cn } from '@/lib/utils';
import { ingestFiles, type IngestedAttachment } from '@/lib/files/ingest';
import { BUILTIN_SKILLS, isSkillCreatorId, skillSlashName } from '@/lib/skills/creator';
import { isImageAttachment } from '@/components/attachment-image-thumb';
import type { FilePreviewPayload } from '@/components/file-preview-overlay';
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
  const [editingMessageAttachments, setEditingMessageAttachments] = useState<IngestedAttachment[]>(
    [],
  );
  
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
  const [isAccountBound, setIsAccountBound] = useState(false);
  const [tempKeyInput, setTempKeyInput] = useState<string>('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  /** `notion` | `github` = MCP connect sheet; `login` = first-time sign-in only. */
  const [authModalMode, setAuthModalMode] = useState<'login' | 'notion' | 'github' | 'google'>('login');
  const [showApiKeyLogin, setShowApiKeyLogin] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountUsername, setAccountUsername] = useState<string | null>(null);
  const [notionStatus, setNotionStatus] = useState<{
    connected: boolean;
    available: boolean;
    label?: string;
  } | null>(null);
  const [notionBusy, setNotionBusy] = useState(false);
  const [githubStatus, setGitHubStatus] = useState<{
    connected: boolean;
    available: boolean;
    label?: string;
  } | null>(null);
  const [githubBusy, setGitHubBusy] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<{
    connected: boolean;
    available: boolean;
    label?: string;
  } | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  /** Gate localStorage writes until boot has restored (or decided there is nothing). */
  const [chatsHydrated, setChatsHydrated] = useState(false);

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

  // Skills State
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [isSavingSkill, setIsSavingSkill] = useState(false);
  const [googleMcpMenuOpen, setGoogleMcpMenuOpen] = useState(false);
  const [plusFlyout, setPlusFlyout] = useState<
    null | 'commands' | 'skills' | 'mcp' | 'tools'
  >(null);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [skillDraftTitle, setSkillDraftTitle] = useState('');
  const [skillDraftContent, setSkillDraftContent] = useState('');
  const [skillModalError, setSkillModalError] = useState('');
  const [skillPendingDelete, setSkillPendingDelete] = useState<SkillItem | null>(null);
  const [isDeletingSkill, setIsDeletingSkill] = useState(false);
  const [isSkillPickerOpen, setIsSkillPickerOpen] = useState(false);
  const [slashHighlight, setSlashHighlight] = useState(0);
  const skillPickerRef = useRef<HTMLDivElement>(null);
  const plusMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(false);
  const [attachmentsExpanded, setAttachmentsExpanded] = useState(false);
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
  const [attachments, setAttachments] = useState<IngestedAttachment[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [attachError, setAttachError] = useState('');
  const [imagePreviewSrc, setImagePreviewSrc] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<FilePreviewPayload | null>(null);

  // Settings State
  const [isListening, setIsListening] = useState(false);
  const [queueExpanded, setQueueExpanded] = useState(true);
  /** Explicit open/closed overrides for reasoning panels (message id → open). */
  const [reasoningOpen, setReasoningOpen] = useState<Record<string, boolean>>({});
  const [toolRunOpen, setToolRunOpen] = useState<Record<string, boolean>>({});
  /** Text snippets quoted from message selection into the composer (multi-select). */
  const [quotedSelections, setQuotedSelections] = useState<string[]>([]);
  /** Debounce handle for cloud session sync (cross-device). */
  const cloudSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const skillsRef = useRef(skills);
  const notionStatusRef = useRef(notionStatus);
  const githubStatusRef = useRef(githubStatus);
  const googleStatusRef = useRef(googleStatus);
  const dragDepthRef = useRef(0);
  // Only auto-follow new tokens while the user is already near the bottom.
  const stickToBottomRef = useRef(true);

  sessionsRef.current = sessions;
  activeSessionIdRef.current = activeSessionId;
  skillsRef.current = skills;
  notionStatusRef.current = notionStatus;
  githubStatusRef.current = githubStatus;
  googleStatusRef.current = googleStatus;


  const scrubNotionMcpFromSessions = () => {
    setSessions((prev) =>
      prev.map((s) => {
        const next = (s.mcpIds || []).filter((id) => id !== 'notion');
        if (next.length === (s.mcpIds || []).length) return s;
        return { ...s, mcpIds: next, updatedAt: Date.now() };
      }),
    );
    setActiveMcpIds((prev) => prev.filter((id) => id !== 'notion'));
  };

  const scrubGitHubMcpFromSessions = () => {
    setSessions((prev) =>
      prev.map((s) => {
        const next = (s.mcpIds || []).filter((id) => id !== 'github');
        if (next.length === (s.mcpIds || []).length) return s;
        return { ...s, mcpIds: next, updatedAt: Date.now() };
      }),
    );
    setActiveMcpIds((prev) => prev.filter((id) => id !== 'github'));
  };

  const scrubGoogleMcpFromSessions = () => {
    setSessions((prev) =>
      prev.map((s) => {
        const next = (s.mcpIds || []).filter((id) => !isGoogleMcpId(id));
        if (next.length === (s.mcpIds || []).length) return s;
        return { ...s, mcpIds: next, updatedAt: Date.now() };
      }),
    );
    setActiveMcpIds((prev) => prev.filter((id) => !isGoogleMcpId(id)));
  };

  const refreshAccountStatus = async (): Promise<{
    bound: boolean;
    username: string | null;
  }> => {
    try {
      const response = await fetch('/api/account', { cache: 'no-store' });
      const data = await response.json();
      const bound = Boolean(data?.bound);
      const username = bound && data?.username ? String(data.username) : null;
      setIsAccountBound(bound);
      setAccountUsername(username);
      return { bound, username };
    } catch {
      setIsAccountBound(false);
      setAccountUsername(null);
      return { bound: false, username: null };
    }
  };

  const fetchIntegrations = async () => {
    try {
      const response = await fetch('/api/integrations', { cache: 'no-store' });
      if (!response.ok) {
        setNotionStatus(null);
        setGitHubStatus(null);
        setGoogleStatus(null);
        scrubNotionMcpFromSessions();
        scrubGitHubMcpFromSessions();
        scrubGoogleMcpFromSessions();
        return;
      }
      const data = await response.json();
      const list = (data?.integrations || []) as Array<{
        provider?: string;
        connected?: boolean;
        available?: boolean;
        label?: string;
      }>;
      const notion = list.find((i) => i?.provider === 'notion');
      const github = list.find((i) => i?.provider === 'github');
      const google = list.find((i) => i?.provider === 'google');

      if (!notion) {
        setNotionStatus(null);
        scrubNotionMcpFromSessions();
      } else {
        const connected = Boolean(notion.connected);
        setNotionStatus({
          connected,
          available: Boolean(notion.available),
          label: notion.label || undefined,
        });
        if (!connected) scrubNotionMcpFromSessions();
      }

      if (!github) {
        setGitHubStatus(null);
        scrubGitHubMcpFromSessions();
      } else {
        const connected = Boolean(github.connected);
        setGitHubStatus({
          connected,
          available: Boolean(github.available),
          label: github.label || undefined,
        });
        if (!connected) scrubGitHubMcpFromSessions();
      }

      if (!google) {
        setGoogleStatus(null);
        scrubGoogleMcpFromSessions();
      } else {
        const connected = Boolean(google.connected);
        setGoogleStatus({
          connected,
          available: Boolean(google.available),
          label: google.label || undefined,
        });
        if (!connected) scrubGoogleMcpFromSessions();
      }
    } catch {
      setNotionStatus(null);
      setGitHubStatus(null);
      setGoogleStatus(null);
      scrubNotionMcpFromSessions();
      scrubGitHubMcpFromSessions();
      scrubGoogleMcpFromSessions();
    }
  };

  const disconnectNotion = async () => {
    setNotionBusy(true);
    try {
      await fetch('/api/integrations/notion', { method: 'DELETE' });
      await fetchIntegrations();
    } finally {
      setNotionBusy(false);
    }
  };

  const disconnectGitHub = async () => {
    setGitHubBusy(true);
    try {
      await fetch('/api/integrations/github', { method: 'DELETE' });
      await fetchIntegrations();
    } finally {
      setGitHubBusy(false);
    }
  };

  const disconnectGoogle = async () => {
    setGoogleBusy(true);
    try {
      await fetch('/api/integrations/google', { method: 'DELETE' });
      await fetchIntegrations();
    } finally {
      setGoogleBusy(false);
    }
  };

  useEffect(() => {
    if (!showAuthModal || !isAccountBound) return;
    if (authModalMode !== 'notion' && authModalMode !== 'github' && authModalMode !== 'google') return;
    void fetchIntegrations();
  }, [showAuthModal, authModalMode, isAccountBound]);

  // Load Saved State
  useEffect(() => {
    // Migrate away from the old insecure client-side key storage.
    localStorage.removeItem('llm_christmas_user_key');

    try {
      const params = new URLSearchParams(window.location.search);
      const authError = params.get('auth_error');
      const notionOk = params.get('notion_connected');
      const notionAuthReturn = params.get('notion_auth');
      const githubOk = params.get('github_connected');
      const githubAuthReturn = params.get('github_auth');
      const googleOk = params.get('google_connected');
      const googleAuthReturn = params.get('google_auth');
      const mainConnected = params.get('connected');

      if (
        authError ||
        notionOk ||
        githubOk ||
        googleOk ||
        mainConnected ||
        notionAuthReturn ||
        githubAuthReturn ||
        googleAuthReturn
      ) {
        const clean = new URL(window.location.href);
        clean.search = '';
        window.history.replaceState({}, '', clean.pathname);
      }

      void refreshAccountStatus()
        .then(async ({ bound, username }) => {
          // Restore chats BEFORE waiting on models — and before any persist effect
          // runs with an empty sessions array (that used to wipe localStorage).
          if (bound) {
            // Account switch on the same browser: drop the previous account's
            // cached chats so histories never bleed across users.
            const ownerKey = username || 'account';
            try {
              const storedOwner = localStorage.getItem(CHATS_OWNER_KEY);
              if (storedOwner && storedOwner !== ownerKey) {
                localStorage.removeItem('llm_christmas_chats');
              }
              localStorage.setItem(CHATS_OWNER_KEY, ownerKey);
            } catch {
              // ignore
            }

            const savedChats = localStorage.getItem('llm_christmas_chats');
            if (savedChats) {
              try {
                const parsed = JSON.parse(savedChats) as ChatSession[];
                const nonEmpty = parsed
                  .filter(
                    (session) =>
                      session.messages?.length > 0 ||
                      (session.mcpIds && session.mcpIds.length > 0) ||
                      (session.skillIds && session.skillIds.length > 0),
                  )
                  .map(normalizeRestoredSession);
                if (nonEmpty.length > 0) {
                  // Land on a blank New Chat draft (ChatGPT-style), not the
                  // most recent thread — history stays in the sidebar.
                  const draft: ChatSession = {
                    id: crypto.randomUUID(),
                    title: 'New Conversation',
                    messages: [],
                    updatedAt: Date.now(),
                  };
                  setSessions([draft, ...nonEmpty]);
                  setActiveSessionId(draft.id);
                } else {
                  createNewSession();
                }
              } catch {
                createNewSession();
              }
            } else {
              createNewSession();
            }

            // Cloud merge (cross-device sync). Must finish before chatsHydrated
            // flips on the persist/upload effects, or a stale local copy could
            // overwrite newer cloud state.
            try {
              const syncRes = await fetch('/api/sync/sessions', { cache: 'no-store' });
              if (syncRes.ok) {
                const syncData = await syncRes.json();
                const cloud = Array.isArray(syncData?.sessions)
                  ? (syncData.sessions as ChatSession[])
                  : [];
                if (cloud.length > 0) {
                  setSessions((prev) => mergeSyncedSessions(prev, cloud));
                }
              }
            } catch {
              // Offline / portal down: keep the local copy only.
            }
          } else {
            createNewSession();
          }
          setChatsHydrated(true);

          const boot: Array<Promise<unknown>> = [fetchModels()];
          if (bound) {
            boot.push(fetchSkills(), fetchIntegrations());
          }
          await Promise.all(boot);

          if (mainConnected) {
            setAccountError('');
            setShowAuthModal(false);
          }

          if (notionOk) {
            if (bound) {
              setAccountError('');
              setShowAuthModal(false);
            } else {
              setAuthModalMode('login');
              setAccountError(
                'Notion 已授权，但 llm.christmas 登录已失效。请先登录主站账号，再在 MCP 里重新连接 Notion。',
              );
              setShowAuthModal(true);
            }
            return;
          }

          if (githubOk) {
            if (bound) {
              setAccountError('');
              setShowAuthModal(false);
            } else {
              setAuthModalMode('login');
              setAccountError(
                'GitHub 已授权，但 llm.christmas 登录已失效。请先登录主站账号，再在 MCP 里重新连接 GitHub。',
              );
              setShowAuthModal(true);
            }
            return;
          }

          if (googleOk) {
            if (bound) {
              setAccountError('');
              setShowAuthModal(false);
              // Cookie was just set by the OAuth callback — refresh status.
              await fetchIntegrations();
              // First-time connect: enable all three surfaces on the newest chat
              // (index 0 after restore). Mount effect may have a stale activeSessionId.
              setSessions((prev) => {
                if (!prev.length) return prev;
                const target = prev[0];
                const ids = target.mcpIds || [];
                if (ids.some((id) => isGoogleMcpId(id))) return prev;
                const nextIds = [
                  ...ids.filter((id) => id !== 'google'),
                  'gmail',
                  'calendar',
                  'drive',
                ];
                return prev.map((s, i) =>
                  i === 0 ? { ...s, mcpIds: nextIds, updatedAt: Date.now() } : s,
                );
              });
            } else {
              setAuthModalMode('login');
              setAccountError(
                'Google 已授权，但 llm.christmas 登录已失效。请先登录主站账号，再在 MCP 里重新连接 Google。',
              );
              setShowAuthModal(true);
            }
            return;
          }

          if (authError) {
            setAccountError(authError);
            if (githubAuthReturn) setAuthModalMode('github');
            else if (googleAuthReturn) setAuthModalMode('google');
            else if (notionAuthReturn) setAuthModalMode('notion');
            else setAuthModalMode(bound ? 'notion' : 'login');
            setShowAuthModal(true);
            return;
          }

          if (notionAuthReturn && bound) {
            setAuthModalMode('notion');
            setShowAuthModal(true);
          }

          if (githubAuthReturn && bound) {
            setAuthModalMode('github');
            setShowAuthModal(true);
          }

          if (googleAuthReturn && bound) {
            setAuthModalMode('google');
            setShowAuthModal(true);
          }
        })
        .catch(() => {
          fetchModels();
          createNewSession();
          setChatsHydrated(true);
        });
    } catch {
      // ignore
    }
  }, []);

  // Save Sessions ONLY if account is bound — never persist empty drafts.
  // Wait until boot hydration finishes; otherwise isAccountBound flips true while
  // sessions is still [] and we wipe llm_christmas_chats from localStorage.
  useEffect(() => {
    if (!isAccountBound || !chatsHydrated) return;
    // Persist chats with messages, or drafts that already have per-chat MCP/Skills
    // enabled — otherwise toggling GitHub/Notion before the first send is lost on refresh.
    const persisted = sessions.filter(
      (session) =>
        session.messages.length > 0 ||
        (session.mcpIds && session.mcpIds.length > 0) ||
        (session.skillIds && session.skillIds.length > 0),
    );
    if (persisted.length > 0) {
      localStorage.setItem('llm_christmas_chats', JSON.stringify(persisted));
    } else {
      localStorage.removeItem('llm_christmas_chats');
    }
  }, [sessions, isAccountBound, chatsHydrated]);

  // Debounced cloud sync so sessions survive device/browser switches. The portal
  // applies LWW per session id, so replaying equal timestamps is harmless.
  useEffect(() => {
    if (!isAccountBound || !chatsHydrated) return;
    if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
    cloudSyncTimerRef.current = setTimeout(() => {
      const persisted = sessions.filter(
        (session) =>
          session.messages.length > 0 ||
          (session.mcpIds && session.mcpIds.length > 0) ||
          (session.skillIds && session.skillIds.length > 0),
      );
      if (persisted.length === 0) return;
      void fetch('/api/sync/sessions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions: sessionsForCloudSync(persisted) }),
      }).catch(() => {
        // Offline / portal down: localStorage copy remains the fallback.
      });
    }, 1500);
    return () => {
      if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
    };
  }, [sessions, isAccountBound, chatsHydrated]);

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
  const skillCreatorActive = activeSkillIds.some(isSkillCreatorId);
  const setActiveAutoReview = (v: boolean) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSessionId ? { ...s, autoReview: v } : s)),
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
        .map((id) => skills.find((s) => s.id === id))
        .filter((s): s is SkillItem => Boolean(s)),
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



  const downloadGeneratedImage = async (entry: GeneratedImageEntry) => {
    try {
      const res = await fetch(entry.url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `image-${entry.timestamp}.png`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(entry.url, '_blank', 'noopener,noreferrer');
    }
  };

  const downloadGeneratedFile = async (entry: GeneratedFileEntry) => {
    try {
      let blob: Blob;
      if (typeof entry.content === 'string') {
        blob = new Blob([entry.content], {
          type: entry.mimeType || 'text/plain;charset=utf-8',
        });
      } else if (entry.url && !entry.url.startsWith('local://')) {
        const res = await fetch(entry.url);
        blob = await res.blob();
      } else {
        throw new Error('No file content available');
      }
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = entry.name || `file-${entry.createdAt}`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      if (entry.url && !entry.url.startsWith('local://')) {
        window.open(entry.url, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const isEmptyAssistantShell = (m: Message) =>
    m.role === 'assistant' &&
    !m.content?.trim() &&
    !m.images?.length &&
    !m.files?.length &&
    !m.reasoning &&
    !m.toolRuns?.length;

  const removeGeneratedImage = (entry: GeneratedImageEntry) => {
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

  const setActiveSkillIds = (updater: string[] | ((prev: string[]) => string[])) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        const next = typeof updater === 'function' ? updater(s.skillIds || []) : updater;
        return { ...s, skillIds: next, updatedAt: Date.now() };
      }),
    );
  };

  const setActiveMcpIds = (updater: string[] | ((prev: string[]) => string[])) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        const next = typeof updater === 'function' ? updater(s.mcpIds || []) : updater;
        return { ...s, mcpIds: next, updatedAt: Date.now() };
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

  const toggleSkill = (skillId: string) => {
    setActiveSkillIds((prev) =>
      prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId],
    );
  };

  const attachSkill = (skill: SkillItem) => {
    setActiveSkillIds((prev) => (prev.includes(skill.id) ? prev : [...prev, skill.id]));
    setIsSkillPickerOpen(false);
  };

  /** Trailing `/query` at start of input or after a newline — slash-command mode. */
  const slashMatch = input.match(/(?:^|\n)\/([^\n]*)$/);
  const slashRaw = slashMatch ? slashMatch[1] : null;
  const slashQuery = slashRaw != null ? slashRaw.trim().toLowerCase() : null;
  /** True once the user typed a space after `/cmd` (arguments started). */
  const slashHasArgs = slashRaw != null && /\s/.test(slashRaw);

  type SlashMenuItem =
    | { kind: 'command'; id: string; title: string; insert: string; hint: string }
    | { kind: 'skill'; skill: SkillItem };

  const slashMenuItems = useMemo((): SlashMenuItem[] => {
    // Hide once a command is complete (`/image`) or args started (`/image …`).
    if (slashQuery == null || slashHasArgs) return [];
    const items: SlashMenuItem[] = [];
    const imagePrefix =
      slashQuery === '' ||
      ('image'.startsWith(slashQuery) && slashQuery !== 'image') ||
      ('img'.startsWith(slashQuery) && slashQuery !== 'img');
    if (imagePrefix) {
      items.push({
        kind: 'command',
        id: 'image',
        title: t('generateImage'),
        insert: '/image ',
        hint: t('imageHint'),
      });
    }
    if (isAccountBound) {
      for (const s of skills) {
        const name = skillSlashName(s.title);
        if (
          slashQuery === '' ||
          (name.startsWith(slashQuery) && name !== slashQuery) ||
          (s.title.toLowerCase().includes(slashQuery) && name !== slashQuery)
        ) {
          items.push({ kind: 'skill', skill: s });
        }
      }
    }
    return items.slice(0, 8);
  }, [slashQuery, slashHasArgs, skills, isAccountBound]);

  const consumeSlashItem = (item: SlashMenuItem) => {
    if (item.kind === 'command') {
      setInput((prev) =>
        prev.replace(/(?:^|\n)\/[^\n]*$/, (seg) => (seg.startsWith('\n') ? `\n${item.insert}` : item.insert)),
      );
      setIsSkillPickerOpen(false);
      setSlashHighlight(0);
      return;
    }
    attachSkill(item.skill);
    setInput((prev) => prev.replace(/(?:^|\n)\/[^\n]*$/, (seg) => (seg.startsWith('\n') ? '\n' : '')));
    setSlashHighlight(0);
  };

  const lastMessage = messages[messages.length - 1];
  const truncationInfo = useMemo(() => {
    if (!lastMessage || lastMessage.role !== 'assistant') {
      return { truncated: false, reason: '' };
    }
    // Failed requests need Retry, not Continue-from-partial.
    if (isAssistantError(lastMessage)) {
      return { truncated: false, reason: '' };
    }
    // Refresh / navigate away mid-stream often leaves an empty incomplete bubble
    // (Process was spinning, no answer token yet). Offer Continue to re-run.
    if (lastMessage.incomplete && !String(lastMessage.content || '').trim()) {
      return {
        truncated: true,
        reason: lastMessage.truncationReason || 'Reply was interrupted',
      };
    }
    if (!lastMessage.content?.trim()) {
      return { truncated: false, reason: '' };
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
      return { truncated: false, reason: '' };
    }
    if (base.truncated) return base;

    // Tool failed and the model never finished a recovery answer — common when
    // Notion/GitHub writes error mid-turn and the body dies on a heading.
    const failedTools = (lastMessage.toolRuns || []).some(
      (r) => r.status === 'done' && Boolean(r.error),
    );
    if (failedTools) {
      const abrupt = looksAbruptlyCutOff(lastMessage.content);
      if (abrupt.truncated) return abrupt;
      const body = lastMessage.content.trim();
      // Short narration after a failed write, without acknowledging the error.
      if (
        body.length < 500 &&
        !/(失败|错误|无法|error|failed|invalid|page_id|缺少|参数)/i.test(body)
      ) {
        return { truncated: true, reason: 'Stopped after a tool error' };
      }
    }
    return base;
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
  const createNewSession = () => {
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
  };

  const updateSession = (sessionId: string, newMessages: Message[], title?: string) => {
    setSessions((prev) => {
      const exists = prev.some((s) => s.id === sessionId);
      let next: ChatSession[];
      if (!exists) {
        // First message on a missing draft — materialize the session now.
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
          const collectedSources = collectWebSourcesFromMessages(newMessages);
          const retainedUrls = new Set(collectedSources.map((source) => source.url));
          return {
            ...s,
            messages: newMessages,
            title: title || s.title,
            updatedAt: Date.now(),
            // After an explicit clear, sources are an allowlist. On rollback/edit,
            // keep only allowlisted sources that still exist in the retained thread.
            webSources: s.webSourcesCleared
              ? (s.webSources || []).filter((source) => retainedUrls.has(source.url))
              : collectedSources,
          };
        });
      }
      // Same-tick readers (streamChatResponse / queue) must see truncated history
      // before React paints — otherwise rollback looks like only Material changed.
      sessionsRef.current = next;
      return next;
    });
  };

  const updateActiveSession = (newMessages: Message[], title?: string) => {
    updateSession(activeSessionId, newMessages, title);
  };

  const clearWebSources = () => {
    setWebSourcesCleared(true);
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? { ...s, webSources: undefined, webSourcesCleared: true }
          : s,
      ),
    );
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
  ) =>
    runStreamChatResponse(
      {
        getSessions: () => sessionsRef.current,
        setSessions,
        selectedModel,
        systemPrompt,
        skillsPayloadForSession,
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
      },
      sessionId,
      apiMessages,
      assistantId,
      signal,
      initialContent,
      seamPrefix,
      webSourcesOverride,
      requestReview,
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
      const response = await fetch('/api/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: trimmed }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || '绑定失败');
      setTempKeyInput('');
      closeAuthModal();
      if (data?.username) setAccountUsername(String(data.username));
      await refreshAccountStatus();
      await fetchModels();
      await fetchSkills();
      await fetchIntegrations();
    } catch (error: any) {
      setAccountError(error?.message || '绑定失败');
    } finally {
      setAccountSaving(false);
    }
  };

  const disconnectAccount = async () => {
    await fetch('/api/account', { method: 'DELETE' });
    setIsAccountBound(false);
    setAccountUsername(null);
    setTempKeyInput('');
    setActiveMcpIds((prev) => prev.filter((id) => id !== 'zhipu-vision'));
    closeAuthModal();
    setNotionStatus(null);
    setGitHubStatus(null);
    setGoogleStatus(null);
    setSessions([]);
    setSkills([]);
    try {
      localStorage.removeItem('llm_christmas_chats');
      localStorage.removeItem(CHATS_OWNER_KEY);
    } catch {
      // ignore
    }
    createNewSession();
    await fetchModels();
  };

  const applyIngestedFiles = async (
    files: FileList | File[],
    append: (placeholders: IngestedAttachment[]) => void,
    patch: (id: string, updater: (x: IngestedAttachment) => IngestedAttachment) => void,
  ) => {
    setAttachError('');
    const { attachments: next, errors } = await ingestFiles(files);

    const placeholders: IngestedAttachment[] = next.map((a) => ({
      ...a,
      uploading: Boolean(a.dataUrl && isAccountBound),
    }));

    if (placeholders.length > 0) {
      append(placeholders);
    }

    for (const a of next) {
      if (!a.dataUrl || !isAccountBound) continue;

      try {
        const res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl: a.dataUrl, filename: a.name }),
        });
        const data = await res.json();
        if (res.ok && data?.id) {
          const fileId = String(data.id);
          patch(a.id, (x) => ({
            ...x,
            uploading: false,
            uploadError: false,
            fileId,
            previewUrl: `/api/files/${encodeURIComponent(fileId)}`,
          }));
          continue;
        }
        if (isAccountBound) {
          patch(a.id, (x) => ({ ...x, uploading: false, uploadError: !x.dataUrl }));
          continue;
        }
      } catch {
        if (isAccountBound) {
          patch(a.id, (x) => ({ ...x, uploading: false, uploadError: !x.dataUrl }));
          continue;
        }
      }

      patch(a.id, (x) => ({ ...x, uploading: false }));
    }
    if (errors.length > 0) setAttachError(errors.join(' · '));
  };

  const addIngestedFiles = async (files: FileList | File[]) => {
    await applyIngestedFiles(
      files,
      (placeholders) => {
        setAttachments((prev) => [...prev, ...placeholders]);
        setAttachmentsExpanded(true);
      },
      (id, updater) => setAttachments((prev) => prev.map((x) => (x.id === id ? updater(x) : x))),
    );
  };

  const addEditIngestedFiles = async (files: FileList | File[]) => {
    await applyIngestedFiles(
      files,
      (placeholders) => setEditingMessageAttachments((prev) => [...prev, ...placeholders]),
      (id, updater) =>
        setEditingMessageAttachments((prev) => prev.map((x) => (x.id === id ? updater(x) : x))),
    );
  };

  const removeEditingMessageAttachment = (id: string) => {
    setEditingMessageAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((a) => a.id !== id);
    });
  };

  const removeAttachment = (id: string) => {
    const toRemove = attachments.find((a) => a.id === id);
    if (toRemove?.previewUrl) URL.revokeObjectURL(toRemove.previewUrl);
    setAttachments((prev) => prev.filter((a) => a.id !== id));
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
    stopGenerating,
    handleSubmit,
    loadingBySession,
    isSessionLoading,
    isActiveLoading,
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

  // Only offer Continue when we have a clear interruption signal — not for every
  // finished assistant turn.
  const canResumeIncomplete = !isActiveLoading && truncationInfo.truncated;
  // Timeout / upstream failures leave an Error: bubble — offer Retry for that turn.
  const canRetryFailed = !isActiveLoading && isAssistantError(lastMessage);

  // After refresh / remount / lost tool-done events, orphan tool runs can stay at
  // status:"start" and spin forever. Close them whenever the session is idle.
  useEffect(() => {
    if (!chatsHydrated) return;
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (loadingBySession[s.id]) return s;
        let sessionChanged = false;
        const messages = s.messages.map((m) => {
          if (m.role !== 'assistant') return m;
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
  }, [chatsHydrated, loadingBySession]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isActiveLoading]);

  // Switching conversations should land at the latest message.
  useEffect(() => {
    stickToBottomRef.current = true;
    scrollToBottom(true);
  }, [activeSessionId]);

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

  // Fetch dynamic models from backend. The server decides free/full access from its HttpOnly cookie.
  const fetchModels = async () => {
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
  };

  const fetchSkills = async () => {
    try {
      const res = await fetch('/api/skills', { cache: 'no-store' });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setSkills(json.data);
      }
    } catch (e) {
      console.error('Failed to fetch skills', e);
    }
  };

  const openNewSkillModal = () => {
    setSkillDraftTitle('');
    setSkillDraftContent('');
    setSkillModalError('');
    setShowSkillModal(true);
  };

  const createSkill = async (title: string, content: string) => {
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle || !trimmedContent) {
      setSkillModalError('请填写名称和内容');
      return false;
    }
    setIsSavingSkill(true);
    setSkillModalError('');
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmedTitle, content: trimmedContent }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '保存失败');
      if (json.success || json.data) {
        const saved = json.data || { id: crypto.randomUUID(), title: trimmedTitle, content: trimmedContent };
        setSkills((prev) => [saved, ...prev.filter((s) => s.id !== saved.id)]);
        setShowSkillModal(false);
        return true;
      }
      throw new Error(json?.error || '保存失败');
    } catch (e: any) {
      console.error(e);
      setSkillModalError(e?.message || '保存失败');
      alert(e?.message || '保存失败');
      return false;
    } finally {
      setIsSavingSkill(false);
    }
  };

  const requestDeleteSkill = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const skill = skills.find((s) => s.id === id) || null;
    if (!skill) return;
    setSkillPendingDelete(skill);
  };

  const confirmDeleteSkill = async () => {
    if (!skillPendingDelete || isDeletingSkill) return;
    setIsDeletingSkill(true);
    try {
      await fetch(`/api/skills/${skillPendingDelete.id}`, { method: 'DELETE' });
      setSkills((prev) => prev.filter((s) => s.id !== skillPendingDelete.id));
      setActiveSkillIds((prev) => prev.filter((id) => id !== skillPendingDelete.id));
      setSkillPendingDelete(null);
    } catch (e) {
      console.error(e);
    } finally {
      setIsDeletingSkill(false);
    }
  };

  // Remember the user's model choice across refreshes.
  useEffect(() => {
    if (!selectedModel) return;
    localStorage.setItem('llm_christmas_selected_model', selectedModel);
  }, [selectedModel]);

  // Keep slash highlight in range when the filtered list shrinks.
  useEffect(() => {
    setSlashHighlight(0);
  }, [slashQuery]);

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

  const isEnterSubmitBlockedByIme = (
    e: React.KeyboardEvent,
    composingRef: React.MutableRefObject<boolean>,
    enterLockRef: React.MutableRefObject<boolean>,
  ) =>
    e.nativeEvent.isComposing ||
    composingRef.current ||
    enterLockRef.current ||
    e.keyCode === 229;

  const bindImeGuards = (
    composingRef: React.MutableRefObject<boolean>,
    enterLockRef: React.MutableRefObject<boolean>,
  ) => ({
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: () => {
      composingRef.current = false;
      enterLockRef.current = true;
      window.setTimeout(() => {
        enterLockRef.current = false;
      }, 30);
    },
  });

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
      enqueueOrSubmit();
    }
  };

  const handleEditMessageKeyDown = (e: React.KeyboardEvent, messageId: string) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isEnterSubmitBlockedByIme(e, editImeComposingRef, editImeEnterLockRef)) {
        return;
      }
      e.preventDefault();
      if (e.repeat) return;
      void saveEditedMessage(messageId);
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
        canContinue={Boolean(
          !isActiveLoading &&
            lastMessage &&
            lastMessage.role === 'assistant' &&
            !isAssistantError(lastMessage),
        )}
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
        onRequestClaimReview={() => {
          void requestClaimReview();
        }}
        onContinueReply={() => {
          void resumeIncompleteReply({ force: true });
        }}
        onOpenNewSkillModal={openNewSkillModal}
        onToggleSkill={toggleSkill}
        onRequestDeleteSkill={requestDeleteSkill}
        onFetchSkills={fetchSkills}
        onFetchIntegrations={() => {
          void fetchIntegrations();
        }}
        onOpenNotionModal={openNotionModal}
        onOpenGitHubModal={openGitHubModal}
        onOpenGoogleModal={openGoogleModal}
        onOpenLoginModal={openLoginModal}
        onSetAutoReview={setActiveAutoReview}
        onDisconnectAccount={disconnectAccount}
      />

        {/* --- Main Area --- */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#F9F8F6] dark:bg-stone-950 h-full overflow-hidden">
        
        {/* Minimal Header */}
        <header className="flex h-14 items-center justify-between px-4 border-b border-stone-200/50 dark:border-stone-800/50 bg-[#F9F8F6] dark:bg-stone-950 z-10 shrink-0">
          <div className="flex items-center gap-3">
            {!isSidebarOpen && (
              <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(true)} className="text-stone-500 hover:bg-stone-200/50 dark:hover:bg-stone-800/50">
                <Menu className="h-5 w-5" />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setIsContextPanelOpen(!isContextPanelOpen)}
              className={cn("text-xs gap-1.5", isContextPanelOpen ? "bg-stone-200/50 dark:bg-stone-800 text-stone-900 dark:text-stone-100" : "text-stone-500")}
            >
              {isContextPanelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
              {t('context')}
            </Button>
          </div>
        </header>

        {/* Messages and Context Split */}
        <div className="flex-1 flex min-h-0 overflow-hidden relative">
          
          {/* Messages Area */}
          <div className="flex-1 flex flex-col min-w-0">
            <ChatMessageList
              messages={messages}
              selectedModel={selectedModel}
              isActiveLoading={isActiveLoading}
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
              cancelEditMessage={cancelEditMessage}
              saveEditedMessage={saveEditedMessage}
              editUserMessage={editUserMessage}
              parseQuotedUserMessage={parseQuotedUserMessage}
              reasoningOpen={reasoningOpen}
              setReasoningOpen={setReasoningOpen}
              toolRunOpen={toolRunOpen}
              setToolRunOpen={setToolRunOpen}
              setFilePreview={setFilePreview}
              downloadGeneratedFile={downloadGeneratedFile}
              canRetryFailed={canRetryFailed}
              retryFailedReply={retryFailedReply}
              isAssistantError={isAssistantError}
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
          resumeIncompleteReply={resumeIncompleteReply}
          attachments={attachments}
          setImagePreviewSrc={setImagePreviewSrc}
          removeAttachment={removeAttachment}
          activeSkills={activeSkills}
          toggleSkill={toggleSkill}
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
          isActiveLoading={isActiveLoading}
          isCompacting={isCompacting}
          stopGenerating={stopGenerating}
          enqueueOrSubmit={enqueueOrSubmit}
        />

      </div>
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
      </div>

      <ChatQuoteToolbar
        messagesContentRef={messagesContentRef}
        scrollRef={scrollRef}
        onQuote={quoteSelectedText}
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
        skillDraftTitle={skillDraftTitle}
        setSkillDraftTitle={setSkillDraftTitle}
        skillDraftContent={skillDraftContent}
        setSkillDraftContent={setSkillDraftContent}
        skillModalError={skillModalError}
        isSavingSkill={isSavingSkill}
        onSaveSkill={() => {
          void createSkill(skillDraftTitle, skillDraftContent);
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
