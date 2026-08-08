/**
 * OAuth MCP connection health — reusable across Notion / GitHub / Google / future providers.
 *
 * Vault `connected` stays as-is; live probe (or stream auth failure) may set
 * `needsReconnect` without wiping stored tokens.
 */

export type OAuthMcpProviderId = 'notion' | 'github' | 'google';

export type LiveProbeResult =
  | { kind: 'ok' }
  | { kind: 'needs_reconnect' }
  | { kind: 'inconclusive' };

export type OAuthMcpProviderConfig = {
  id: OAuthMcpProviderId;
  /** OAuth start path for Connect / Reconnect CTAs. */
  startPath: string;
  /** Live health endpoint; when present, fetchIntegrations runs it after vault snap. */
  probePath: string;
  /** Stream response header that signals requested-but-unauthorized. */
  streamAuthHeader: `X-${string}-Auth`;
};

/** Register new OAuth MCP providers here — client health + UI read from this table. */
export const OAUTH_MCP_PROVIDERS: readonly OAuthMcpProviderConfig[] = [
  {
    id: 'notion',
    startPath: '/api/integrations/notion/start',
    probePath: '/api/integrations/notion/probe',
    streamAuthHeader: 'X-Notion-Auth',
  },
  {
    id: 'github',
    startPath: '/api/integrations/github/start',
    probePath: '/api/integrations/github/probe',
    streamAuthHeader: 'X-GitHub-Auth',
  },
  {
    id: 'google',
    startPath: '/api/integrations/google/start',
    probePath: '/api/integrations/google/probe',
    streamAuthHeader: 'X-Google-Auth',
  },
] as const;

export function oauthMcpProvider(
  id: OAuthMcpProviderId,
): OAuthMcpProviderConfig | undefined {
  return OAUTH_MCP_PROVIDERS.find((p) => p.id === id);
}

type ProbeableStatus = {
  connected: boolean;
  needsReconnect?: boolean;
};

/**
 * Live check via `/api/integrations/{provider}/probe`.
 * - 401 / usable:false → needs reconnect
 * - network / 5xx → inconclusive (do not flip vault-connected UI)
 */
export async function probeProviderLiveStatus(
  provider: OAuthMcpProviderId,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveProbeResult> {
  const cfg = oauthMcpProvider(provider);
  if (!cfg?.probePath) return { kind: 'inconclusive' };

  try {
    const response = await fetchImpl(cfg.probePath, { cache: 'no-store' });
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
export function applyLiveProbe<T extends ProbeableStatus>(
  status: T,
  probe: LiveProbeResult,
): T {
  if (!status.connected) {
    return { ...status, needsReconnect: false };
  }
  if (probe.kind === 'needs_reconnect') {
    return { ...status, needsReconnect: true };
  }
  if (probe.kind === 'ok') {
    return { ...status, needsReconnect: false };
  }
  return status;
}

/** Vault connected and live auth still usable for tools. */
export function isIntegrationUsable(
  status: ProbeableStatus | null | undefined,
): boolean {
  return Boolean(status?.connected && !status.needsReconnect);
}
