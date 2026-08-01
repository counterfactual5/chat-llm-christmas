/**
 * Client integration status against `/api/integrations`.
 * Pure helpers — no React. MCP scrub is a session transform, not UI.
 */

import type { ChatSession } from '@/lib/chat/types';
import { isGoogleMcpId } from '@/lib/integrations';

export type IntegrationProvider = 'notion' | 'github' | 'google';

export type IntegrationStatus = {
  connected: boolean;
  available: boolean;
  label?: string;
};

export type IntegrationsSnapshot = {
  notion: IntegrationStatus | null;
  github: IntegrationStatus | null;
  google: IntegrationStatus | null;
};

type ApiRow = {
  provider?: string;
  connected?: boolean;
  available?: boolean;
  label?: string;
};

function rowToStatus(row: ApiRow | undefined): IntegrationStatus | null {
  if (!row) return null;
  return {
    connected: Boolean(row.connected),
    available: Boolean(row.available),
    label: row.label || undefined,
  };
}

export async function fetchIntegrationsSnapshot(
  fetchImpl: typeof fetch = fetch,
): Promise<IntegrationsSnapshot> {
  try {
    const response = await fetchImpl('/api/integrations', { cache: 'no-store' });
    if (!response.ok) {
      return { notion: null, github: null, google: null };
    }
    const data = await response.json();
    const list = (data?.integrations || []) as ApiRow[];
    return {
      notion: rowToStatus(list.find((i) => i?.provider === 'notion')),
      github: rowToStatus(list.find((i) => i?.provider === 'github')),
      google: rowToStatus(list.find((i) => i?.provider === 'google')),
    };
  } catch {
    return { notion: null, github: null, google: null };
  }
}

export async function disconnectIntegration(
  provider: IntegrationProvider,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await fetchImpl(`/api/integrations/${provider}`, { method: 'DELETE' });
}

/** Drop a single MCP id from every session's mcpIds. */
export function stripMcpIdFromSessions(
  sessions: ChatSession[],
  mcpId: string,
): ChatSession[] {
  return sessions.map((s) => {
    const next = (s.mcpIds || []).filter((id) => id !== mcpId);
    if (next.length === (s.mcpIds || []).length) return s;
    return { ...s, mcpIds: next, updatedAt: Date.now() };
  });
}

/** Drop all Google surface MCP ids (gmail/calendar/drive/legacy google). */
export function stripGoogleMcpFromSessions(sessions: ChatSession[]): ChatSession[] {
  return sessions.map((s) => {
    const next = (s.mcpIds || []).filter((id) => !isGoogleMcpId(id));
    if (next.length === (s.mcpIds || []).length) return s;
    return { ...s, mcpIds: next, updatedAt: Date.now() };
  });
}

/** First-time Google connect: enable gmail+calendar+drive on the newest chat. */
export function enableGoogleSurfacesOnNewestSession(
  sessions: ChatSession[],
): ChatSession[] {
  if (!sessions.length) return sessions;
  const target = sessions[0];
  const ids = target.mcpIds || [];
  if (ids.some((id) => isGoogleMcpId(id))) return sessions;
  const nextIds = [...ids.filter((id) => id !== 'google'), 'gmail', 'calendar', 'drive'];
  return sessions.map((s, i) =>
    i === 0 ? { ...s, mcpIds: nextIds, updatedAt: Date.now() } : s,
  );
}
