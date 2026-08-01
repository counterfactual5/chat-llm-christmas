'use client';

import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ChatSession } from '@/lib/chat/types';
import {
  CHATS_OWNER_KEY,
  mergeSyncedSessions,
  normalizeRestoredSession,
  sessionsForCloudSync,
  sessionsWorthPersisting,
} from '@/lib/chat/sessions';
import { isGoogleMcpId } from '@/lib/integrations';

export type IntegrationStatus = {
  connected: boolean;
  available: boolean;
  label?: string;
} | null;

export type AuthModalMode = 'login' | 'notion' | 'github' | 'google';

export type UseChatSessionBootArgs = {
  sessions: ChatSession[];
  setSessions: Dispatch<SetStateAction<ChatSession[]>>;
  setActiveSessionId: Dispatch<SetStateAction<string>>;
  /** Assigned by the container after session CRUD helpers are defined. */
  createNewSessionRef: MutableRefObject<() => void>;
  fetchModelsRef: MutableRefObject<() => Promise<void>>;
  fetchSkillsRef: MutableRefObject<() => Promise<void>>;
  setActiveMcpIdsRef: MutableRefObject<
    (updater: string[] | ((prev: string[]) => string[])) => void
  >;
  showAuthModal: boolean;
  authModalMode: AuthModalMode;
  setShowAuthModal: Dispatch<SetStateAction<boolean>>;
  setAuthModalMode: Dispatch<SetStateAction<AuthModalMode>>;
  setAccountError: Dispatch<SetStateAction<string>>;
};

/**
 * Account binding, integrations status, chat hydrate/boot, and local+cloud persist.
 * Pure client — does not touch /api/chat or SSE.
 */
export function useChatSessionBoot({
  sessions,
  setSessions,
  setActiveSessionId,
  createNewSessionRef,
  fetchModelsRef,
  fetchSkillsRef,
  setActiveMcpIdsRef,
  showAuthModal,
  authModalMode,
  setShowAuthModal,
  setAuthModalMode,
  setAccountError,
}: UseChatSessionBootArgs) {
  const [isAccountBound, setIsAccountBound] = useState(false);
  const [accountUsername, setAccountUsername] = useState<string | null>(null);
  const [notionStatus, setNotionStatus] = useState<IntegrationStatus>(null);
  const [notionBusy, setNotionBusy] = useState(false);
  const [githubStatus, setGitHubStatus] = useState<IntegrationStatus>(null);
  const [githubBusy, setGitHubBusy] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<IntegrationStatus>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  /** Gate localStorage writes until boot has restored (or decided there is nothing). */
  const [chatsHydrated, setChatsHydrated] = useState(false);
  const cloudSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrubNotionMcpFromSessions = () => {
    setSessions((prev) =>
      prev.map((s) => {
        const next = (s.mcpIds || []).filter((id) => id !== 'notion');
        if (next.length === (s.mcpIds || []).length) return s;
        return { ...s, mcpIds: next, updatedAt: Date.now() };
      }),
    );
    setActiveMcpIdsRef.current((prev) => prev.filter((id) => id !== 'notion'));
  };

  const scrubGitHubMcpFromSessions = () => {
    setSessions((prev) =>
      prev.map((s) => {
        const next = (s.mcpIds || []).filter((id) => id !== 'github');
        if (next.length === (s.mcpIds || []).length) return s;
        return { ...s, mcpIds: next, updatedAt: Date.now() };
      }),
    );
    setActiveMcpIdsRef.current((prev) => prev.filter((id) => id !== 'github'));
  };

  const scrubGoogleMcpFromSessions = () => {
    setSessions((prev) =>
      prev.map((s) => {
        const next = (s.mcpIds || []).filter((id) => !isGoogleMcpId(id));
        if (next.length === (s.mcpIds || []).length) return s;
        return { ...s, mcpIds: next, updatedAt: Date.now() };
      }),
    );
    setActiveMcpIdsRef.current((prev) => prev.filter((id) => !isGoogleMcpId(id)));
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
                  createNewSessionRef.current();
                }
              } catch {
                createNewSessionRef.current();
              }
            } else {
              createNewSessionRef.current();
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
            createNewSessionRef.current();
          }
          setChatsHydrated(true);

          const boot: Array<Promise<unknown>> = [fetchModelsRef.current()];
          if (bound) {
            boot.push(fetchSkillsRef.current(), fetchIntegrations());
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
          void fetchModelsRef.current();
          createNewSessionRef.current();
          setChatsHydrated(true);
        });
    } catch {
      // ignore
    }
    // Mount-only boot — callbacks are read from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save Sessions ONLY if account is bound — never persist empty drafts.
  // Wait until boot hydration finishes; otherwise isAccountBound flips true while
  // sessions is still [] and we wipe llm_christmas_chats from localStorage.
  useEffect(() => {
    if (!isAccountBound || !chatsHydrated) return;
    // Persist chats with messages, or drafts that already have per-chat MCP/Skills
    // enabled — otherwise toggling GitHub/Notion before the first send is lost on refresh.
    const persisted = sessionsWorthPersisting(sessions);
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
      const persisted = sessionsWorthPersisting(sessions);
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

  return {
    isAccountBound,
    setIsAccountBound,
    accountUsername,
    setAccountUsername,
    chatsHydrated,
    notionStatus,
    setNotionStatus,
    notionBusy,
    githubStatus,
    setGitHubStatus,
    githubBusy,
    googleStatus,
    setGoogleStatus,
    googleBusy,
    refreshAccountStatus,
    fetchIntegrations,
    disconnectNotion,
    disconnectGitHub,
    disconnectGoogle,
    scrubNotionMcpFromSessions,
    scrubGitHubMcpFromSessions,
    scrubGoogleMcpFromSessions,
  };
}
