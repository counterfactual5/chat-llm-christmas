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
  /** Vault still has tokens, but live Google APIs rejected them. */
  needsReconnect?: boolean;
};

export type IntegrationsSnapshot = {
  notion: IntegrationStatus | null;
  github: IntegrationStatus | null;
  google: IntegrationStatus | null;
};

/** Outcome of probing Google REST APIs against stored OAuth tokens. */
export type GoogleLiveProbeResult =
  | { kind: 'ok' }
  | { kind: 'needs_reconnect' }
  | { kind: 'inconclusive' };

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

/**
 * Live check via `/api/integrations/google/probe`.
 * - 401 / usable:false → needs reconnect
 * - network / 5xx → inconclusive (do not flip vault-connected UI)
 */
export async function probeGoogleLiveStatus(
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleLiveProbeResult> {
  try {
    const response = await fetchImpl('/api/integrations/google/probe', {
      cache: 'no-store',
    });
    if (response.status === 401) {
      return { kind: 'needs_reconnect' };
    }
    if (!response.ok) {
      return { kind: 'inconclusive' };
    }
    const data = (await response.json()) as { usable?: boolean };
    if (data.usable === false) {
      return { kind: 'needs_reconnect' };
    }
    return { kind: 'ok' };
  } catch {
    return { kind: 'inconclusive' };
  }
}

/** Merge vault snapshot with a live probe without clearing tokens. */
export function applyGoogleLiveProbe(
  status: IntegrationStatus,
  probe: GoogleLiveProbeResult,
): IntegrationStatus {
  if (!status.connected) {
    return { ...status, needsReconnect: false };
  }
  if (probe.kind === 'needs_reconnect') {
    return { ...status, needsReconnect: true };
  }
  if (probe.kind === 'ok') {
    return { ...status, needsReconnect: false };
  }
  // inconclusive: keep prior flag if any, otherwise leave unset
  return status;
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
