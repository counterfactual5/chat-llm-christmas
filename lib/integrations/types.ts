/**
 * Per-user third-party integrations (Notion MCP / GitHub MCP later).
 * Tokens are encrypted and stored in an HttpOnly cookie keyed by owner id
 * (hash of the bound llm.christmas API key) — no shared workspace secret.
 */

export type IntegrationProvider = 'notion' | 'github' | 'google';

/** Notion hosted MCP OAuth connection (per user, in vault cookie). */
export type NotionConnection = {
  /** MCP access token (Bearer for mcp.notion.com). */
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when accessToken expires (best-effort). */
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
  /** Public OAuth client_id used for this connection (needed for refresh). */
  mcpClientId?: string;
  /** Always `mcp` for hosted Notion MCP connections. */
  authKind: 'mcp';
  userId?: string;
  workspaceId?: string;
  workspaceName?: string;
  workspaceIcon?: string | null;
  connectedAt: number;
};

/** Google OAuth token for Workspace MCP (Gmail + Calendar + Drive). */
export type GoogleConnection = {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when accessToken expires (best-effort). */
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
  authKind: 'oauth';
  email?: string;
  connectedAt: number;
};

/** GitHub OAuth token for remote MCP (api.githubcopilot.com). */
export type GitHubConnection = {
  accessToken: string;
  tokenType?: string;
  scope?: string;
  authKind: 'oauth';
  login?: string;
  connectedAt: number;
};

export type IntegrationVault = {
  /** sha-256 of bound API key — must match current request owner. */
  ownerId: string;
  notion?: NotionConnection;
  github?: GitHubConnection;
  google?: GoogleConnection;
  /** Short-lived OAuth state for Google connect (stored encrypted in vault). */
  googleOAuthState?: string;
};

export type IntegrationPublicStatus = {
  provider: IntegrationProvider;
  connected: boolean;
  label?: string;
  connectedAt?: number;
  /** True when OAuth env is missing on the server. */
  available: boolean;
};

export const INTEGRATIONS_COOKIE = 'llm_chat_integrations';
export const NOTION_OAUTH_STATE_COOKIE = 'llm_chat_notion_oauth_state';
/** Short-lived PKCE verifier (+ client_id) for MCP OAuth callback. */
export const NOTION_MCP_PKCE_COOKIE = 'llm_chat_notion_mcp_pkce';
export const GITHUB_OAUTH_STATE_COOKIE = 'llm_chat_github_oauth_state';
export const GOOGLE_OAUTH_STATE_COOKIE = 'llm_chat_google_oauth_state';
