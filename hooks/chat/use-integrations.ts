'use client';

/**
 * Notion / GitHub / Google connection status for the chat shell.
 * Uses `lib/chat/integrations/client` — independent of send/stream.
 */

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { ChatSession } from '@/lib/chat/types';
import {
  disconnectIntegration,
  fetchIntegrationsSnapshot,
  stripGoogleMcpFromSessions,
  stripMcpIdFromSessions,
  type IntegrationStatus,
} from '@/lib/chat/integrations/client';
import { isGoogleMcpId } from '@/lib/integrations';
import type { AuthModalMode } from '@/lib/chat/account/oauth-return';

export type { IntegrationStatus };

export function useChatIntegrations(opts: {
  setSessions: Dispatch<SetStateAction<ChatSession[]>>;
  setActiveMcpIds: (updater: string[] | ((prev: string[]) => string[])) => void;
  isAccountBound: boolean;
  showAuthModal: boolean;
  authModalMode: AuthModalMode;
}) {
  const { setSessions, setActiveMcpIds, isAccountBound, showAuthModal, authModalMode } = opts;

  const [notionStatus, setNotionStatus] = useState<IntegrationStatus | null>(null);
  const [notionBusy, setNotionBusy] = useState(false);
  const [githubStatus, setGitHubStatus] = useState<IntegrationStatus | null>(null);
  const [githubBusy, setGitHubBusy] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<IntegrationStatus | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);

  const scrubNotion = useCallback(() => {
    setSessions((prev) => stripMcpIdFromSessions(prev, 'notion'));
    setActiveMcpIds((prev) => prev.filter((id) => id !== 'notion'));
  }, [setSessions, setActiveMcpIds]);

  const scrubGitHub = useCallback(() => {
    setSessions((prev) => stripMcpIdFromSessions(prev, 'github'));
    setActiveMcpIds((prev) => prev.filter((id) => id !== 'github'));
  }, [setSessions, setActiveMcpIds]);

  const scrubGoogle = useCallback(() => {
    setSessions((prev) => stripGoogleMcpFromSessions(prev));
    setActiveMcpIds((prev) => prev.filter((id) => !isGoogleMcpId(id)));
  }, [setSessions, setActiveMcpIds]);

  const fetchIntegrations = useCallback(async () => {
    const snap = await fetchIntegrationsSnapshot();
    setNotionStatus(snap.notion);
    setGitHubStatus(snap.github);
    setGoogleStatus(snap.google);

    if (!snap.notion?.connected) scrubNotion();
    if (!snap.github?.connected) scrubGitHub();
    if (!snap.google?.connected) scrubGoogle();
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
