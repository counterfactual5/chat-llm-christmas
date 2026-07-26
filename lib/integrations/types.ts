/**
 * Per-user third-party integrations (Notion / GitHub MCP later).
 * Tokens are encrypted and stored in an HttpOnly cookie keyed by owner id
 * (hash of the bound llm.christmas API key) — no shared workspace secret.
 */

export type IntegrationProvider = 'notion';

export type NotionConnection = {
  accessToken: string;
  botId?: string;
  workspaceId?: string;
  workspaceName?: string;
  workspaceIcon?: string | null;
  connectedAt: number;
};

export type IntegrationVault = {
  /** sha-256 of bound API key — must match current request owner. */
  ownerId: string;
  notion?: NotionConnection;
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
