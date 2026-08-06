'use client';

/**
 * Notion / GitHub / Google connection status for the chat shell.
 * Uses `lib/chat/integrations/client` — independent of send/stream.
 *
 * OAuth disconnect scrub is global (strip provider from every chat) and must
 * NOT re-write the active session via setActiveMcpIds — that path can race a
 * session switch and look like per-chat toggles "overwrote" each other.
 * Also: status `null` means "unknown / fetch failed", not "disconnected".
 */

import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { ChatSession } from '@/lib/chat/types';
import {
  disconnectIntegration,
  fetchIntegrationsSnapshot,
  stripGoogleMcpFromSessions,
  stripMcpIdFromSessions,
  type IntegrationStatus,
} from '@/lib/chat/integrations/client';
import type { AuthModalMode } from '@/lib/chat/account/oauth-return';

export type { IntegrationStatus };

export function useChatIntegrations(opts: {
  setSessions: Dispatch<SetStateAction<ChatSession[]>>;
  sessionsRef: MutableRefObject<ChatSession[]>;
  isAccountBound: boolean;
  showAuthModal: boolean;
  authModalMode: AuthModalMode;
}) {
  const { setSessions, sessionsRef, isAccountBound, showAuthModal, authModalMode } =
    opts;

  const [notionStatus, setNotionStatus] = useState<IntegrationStatus | null>(null);
  const [notionBusy, setNotionBusy] = useState(false);
  const [githubStatus, setGitHubStatus] = useState<IntegrationStatus | null>(null);
  const [githubBusy, setGitHubBusy] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<IntegrationStatus | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);

  const applySessions = useCallback(
    (transform: (prev: ChatSession[]) => ChatSession[]) => {
      setSessions((prev) => {
        const next = transform(prev);
        if (next !== prev) sessionsRef.current = next;
        return next;
      });
    },
    [setSessions, sessionsRef],
  );

  const scrubNotion = useCallback(() => {
    applySessions((prev) => stripMcpIdFromSessions(prev, 'notion'));
  }, [applySessions]);

  const scrubGitHub = useCallback(() => {
    applySessions((prev) => stripMcpIdFromSessions(prev, 'github'));
  }, [applySessions]);

  const scrubGoogle = useCallback(() => {
    applySessions((prev) => stripGoogleMcpFromSessions(prev));
  }, [applySessions]);

  const fetchIntegrations = useCallback(async () => {
    const snap = await fetchIntegrationsSnapshot();
    setNotionStatus(snap.notion);
    setGitHubStatus(snap.github);
    setGoogleStatus(snap.google);

    // Only scrub when we know the provider is disconnected. `null` = still
    // loading / fetch failed — wiping mcpIds then looks like toggles won't save.
    if (snap.notion && !snap.notion.connected) scrubNotion();
    if (snap.github && !snap.github.connected) scrubGitHub();
    if (snap.google && !snap.google.connected) scrubGoogle();
  }, [scrubNotion, scrubGitHub, scrubGoogle]);

  const disconnectNotion = useCallback(async () => {
    setNotionBusy(true);
    try {
      await disconnectIntegration('notion');
      await fetchIntegrations();
    } finally {
      setNotionBusy(false);
    }
  }, [fetchIntegrations]);

  const disconnectGitHub = useCallback(async () => {
    setGitHubBusy(true);
    try {
      await disconnectIntegration('github');
      await fetchIntegrations();
    } finally {
      setGitHubBusy(false);
    }
  }, [fetchIntegrations]);

  const disconnectGoogle = useCallback(async () => {
    setGoogleBusy(true);
    try {
      await disconnectIntegration('google');
      await fetchIntegrations();
    } finally {
      setGoogleBusy(false);
    }
  }, [fetchIntegrations]);

  // Refresh when the connect sheet is open for a provider.
  useEffect(() => {
    if (!showAuthModal || !isAccountBound) return;
    if (authModalMode !== 'notion' && authModalMode !== 'github' && authModalMode !== 'google') {
      return;
    }
    void fetchIntegrations();
  }, [showAuthModal, authModalMode, isAccountBound, fetchIntegrations]);

  return {
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
  };
}
