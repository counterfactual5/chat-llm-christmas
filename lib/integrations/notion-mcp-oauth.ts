import type { NotionConnection } from '@/lib/integrations/types';

export const NOTION_MCP_SERVER_URL = 'https://mcp.notion.com/mcp';
export const NOTION_MCP_RESOURCE = 'https://mcp.notion.com';

export type NotionMcpOAuthMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
  scopes_supported?: string[];
};

export type NotionMcpTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  user_id?: string;
  workspace_id?: string;
  email_domain?: string;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function notionMcpOAuthConfigured(): boolean {
  // Hosted MCP uses dynamic client registration + PKCE — no NOTION_CLIENT_* required.
  // Optional override: NOTION_MCP_CLIENT_ID for a pre-registered public client.
  return true;
}

export function notionMcpRedirectUri(reqUrl: string): string {
  const configured = process.env.NOTION_MCP_REDIRECT_URI?.trim();
  if (configured) return configured;
  // Keep the same path as before so production redirect URIs stay stable.
  const origin = new URL(reqUrl).origin;
  return `${origin}/api/integrations/notion/callback`;
}

export async function discoverNotionMcpOAuthMetadata(): Promise<NotionMcpOAuthMetadata> {
  const protectedRes = await fetch(
    `${NOTION_MCP_RESOURCE}/.well-known/oauth-protected-resource`,
    { cache: 'no-store' },
  );
  if (!protectedRes.ok) {
    throw new Error(`Notion MCP protected-resource discovery failed (${protectedRes.status})`);
  }
  const protectedBody = (await protectedRes.json()) as {
    authorization_servers?: string[];
  };
  const authServer = protectedBody.authorization_servers?.[0] || NOTION_MCP_RESOURCE;
  const metaRes = await fetch(`${authServer}/.well-known/oauth-authorization-server`, {
    cache: 'no-store',
  });
  if (!metaRes.ok) {
    throw new Error(`Notion MCP authorization-server discovery failed (${metaRes.status})`);
  }
  const metadata = (await metaRes.json()) as NotionMcpOAuthMetadata;
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error('Notion MCP OAuth metadata missing authorization/token endpoints');
  }
  return metadata;
}

export async function generatePkcePair(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = base64UrlEncode(bytes);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(codeVerifier),
  );
  const codeChallenge = base64UrlEncode(new Uint8Array(digest));
  return { codeVerifier, codeChallenge };
}

export function generateOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Register a public OAuth client (RFC 7591) against Notion MCP.
 * Prefer NOTION_MCP_CLIENT_ID when set to avoid re-registering every start.
 */
export async function resolveNotionMcpClientId(
  metadata: NotionMcpOAuthMetadata,
  redirectUri: string,
): Promise<string> {
  const fromEnv = process.env.NOTION_MCP_CLIENT_ID?.trim();
  if (fromEnv) return fromEnv;

  if (!metadata.registration_endpoint) {
    throw new Error(
      'Notion MCP has no registration_endpoint and NOTION_MCP_CLIENT_ID is unset.',
    );
  }

  const response = await fetch(metadata.registration_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_name: 'Christmas Chat',
      client_uri: process.env.NEXT_PUBLIC_APP_URL?.trim() || undefined,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => ({}))) as {
    client_id?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.client_id) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        `Notion MCP client registration failed (${response.status})`,
    );
  }
  return payload.client_id;
}

export function buildNotionMcpAuthorizeUrl(opts: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope?: string;
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
    // Resource indicator helps some AS implementations mint MCP-audienced tokens.
    resource: NOTION_MCP_RESOURCE,
  });
  if (opts.scope) params.set('scope', opts.scope);
  else params.set('scope', 'default');
  return `${opts.authorizationEndpoint}?${params.toString()}`;
}

export async function exchangeNotionMcpCode(opts: {
  tokenEndpoint: string;
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
}): Promise<NotionMcpTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    code_verifier: opts.codeVerifier,
    resource: NOTION_MCP_RESOURCE,
  });

  const response = await fetch(opts.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'ChristmasChat-NotionMCP/1.0',
    },
    body: body.toString(),
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => ({}))) as NotionMcpTokenResponse & {
    error?: string;
    error_description?: string;
    message?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ||
        payload.message ||
        payload.error ||
        `Notion MCP token exchange failed (${response.status})`,
    );
  }
  return payload;
}

export async function refreshNotionMcpToken(opts: {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
}): Promise<NotionMcpTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
    resource: NOTION_MCP_RESOURCE,
  });

  const response = await fetch(opts.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'ChristmasChat-NotionMCP/1.0',
    },
    body: body.toString(),
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => ({}))) as NotionMcpTokenResponse & {
    error?: string;
    error_description?: string;
    message?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ||
        payload.message ||
        payload.error ||
        `Notion MCP token refresh failed (${response.status})`,
    );
  }
  return payload;
}

export function notionConnectionFromMcpToken(
  token: NotionMcpTokenResponse,
  prev?: Partial<NotionConnection>,
  opts?: { mcpClientId?: string },
): NotionConnection {
  const expiresIn = typeof token.expires_in === 'number' ? token.expires_in : 3600;
  return {
    authKind: 'mcp',
    accessToken: token.access_token,
    refreshToken: token.refresh_token || prev?.refreshToken,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
    tokenType: token.token_type || 'Bearer',
    scope: token.scope || prev?.scope,
    mcpClientId:
      opts?.mcpClientId ||
      prev?.mcpClientId ||
      process.env.NOTION_MCP_CLIENT_ID?.trim() ||
      undefined,
    userId: token.user_id || prev?.userId,
    workspaceId: token.workspace_id || prev?.workspaceId,
    workspaceName: prev?.workspaceName,
    workspaceIcon: prev?.workspaceIcon ?? null,
    connectedAt: prev?.connectedAt || Date.now(),
  };
}

/** Cookie payload for PKCE between start → callback. */
export type NotionMcpPkceCookie = {
  state: string;
  codeVerifier: string;
  clientId: string;
  tokenEndpoint: string;
  authorizationEndpoint?: string;
};

export function encodePkceCookie(value: NotionMcpPkceCookie): string {
  // URL-safe base64 so the value is cookie-safe without quoting issues.
  return btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function decodePkceCookie(raw: string): NotionMcpPkceCookie | null {
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const json = atob(padded + '='.repeat(padLen));
    const parsed = JSON.parse(json) as NotionMcpPkceCookie;
    if (
      !parsed?.state ||
      !parsed?.codeVerifier ||
      !parsed?.clientId ||
      !parsed?.tokenEndpoint
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
