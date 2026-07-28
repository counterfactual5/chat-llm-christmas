import type { GitHubConnection } from '@/lib/integrations/types';

/** GitHub hosted remote MCP (default toolset). */
export const GITHUB_MCP_SERVER_URL = 'https://api.githubcopilot.com/mcp/';

/**
 * Resolve MCP endpoint from `GITHUB_MCP_TOOLSET`.
 * See: https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md
 *
 * - `readonly` (code default if unset): default toolset, read-only
 * - `default` / `write`: default toolset with writes (issues/PRs/etc.)
 * - `full` / `all`: every toolset (`/x/all`)
 * - `x/issues`, `x/pull_requests`, `x/repos`, ...: single toolset path
 */
export function githubMcpServerUrl(): string {
  const base = GITHUB_MCP_SERVER_URL.replace(/\/$/, '');
  const toolset = (process.env.GITHUB_MCP_TOOLSET || 'readonly').trim().toLowerCase();

  if (!toolset || toolset === 'readonly') return `${base}/readonly`;
  if (toolset === 'default' || toolset === 'write') return `${base}/`;
  // Official “all tools” path is /x/all — not bare /
  if (toolset === 'full' || toolset === 'all' || toolset === 'x/all') return `${base}/x/all`;

  const segment = toolset.startsWith('/') ? toolset : `/${toolset}`;
  return `${base}${segment}`;
}

export function githubOAuthConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_OAUTH_CLIENT_ID?.trim() &&
      process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim(),
  );
}

export function githubOAuthRedirectUri(reqUrl: string): string {
  const configured = process.env.GITHUB_OAUTH_REDIRECT_URI?.trim();
  if (configured) return configured;
  const origin = new URL(reqUrl).origin;
  return `${origin}/api/integrations/github/callback`;
}

export function githubOAuthScopes(): string {
  const fromEnv = process.env.GITHUB_OAUTH_SCOPES?.trim();
  if (fromEnv) return fromEnv;
  return 'read:user repo read:org';
}

export function generateOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildGitHubAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: githubOAuthScopes(),
    state: opts.state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export type GitHubTokenResponse = {
  access_token: string;
  token_type?: string;
  scope?: string;
};

export async function exchangeGitHubCode(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GitHubTokenResponse> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    redirect_uri: opts.redirectUri,
  });

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => ({}))) as GitHubTokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        `GitHub token exchange failed (${response.status})`,
    );
  }
  return payload;
}

export async function fetchGitHubLogin(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ChristmasChat-GitHub/1.0',
      },
      cache: 'no-store',
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { login?: string };
    return data.login ? String(data.login) : undefined;
  } catch {
    return undefined;
  }
}

export function githubConnectionFromToken(
  token: GitHubTokenResponse,
  login?: string,
  prev?: Partial<GitHubConnection>,
): GitHubConnection {
  return {
    authKind: 'oauth',
    accessToken: token.access_token,
    tokenType: token.token_type || 'Bearer',
    scope: token.scope || prev?.scope,
    login: login || prev?.login,
    connectedAt: prev?.connectedAt || Date.now(),
  };
}
