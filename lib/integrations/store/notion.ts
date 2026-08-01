/**
 * Notion connection upsert/remove + MCP access token helpers.
 */

import type { NextRequest, NextResponse } from 'next/server';
import {
  discoverNotionMcpOAuthMetadata,
  notionConnectionFromMcpToken,
  refreshNotionMcpToken,
} from '@/lib/integrations/notion/oauth';
import {
  persistVault,
  readVault,
} from '@/lib/integrations/store/vault';
import type { IntegrationVault, NotionConnection } from '@/lib/integrations/types';

export async function upsertNotionConnection(
  req: NextRequest,
  response: NextResponse,
  ownerId: string,
  notion: NotionConnection,
): Promise<IntegrationVault> {
  const vault = await readVault(req, ownerId);
  return persistVault(response, ownerId, { ...vault, ownerId, notion });
}

export async function removeNotionConnection(
  req: NextRequest,
  response: NextResponse,
  ownerId: string,
): Promise<IntegrationVault> {
  const vault = await readVault(req, ownerId);
  const { notion: _removed, ...rest } = vault;
  return persistVault(response, ownerId, { ...rest, ownerId });
}

function isMcpConnection(notion: NotionConnection | undefined): notion is NotionConnection {
  return Boolean(notion?.accessToken && notion.authKind === 'mcp');
}

/** Drop pre-MCP Integration OAuth entries still sitting in the vault cookie. */
export function purgeLegacyNotionFromVault(
  vault: IntegrationVault,
): { vault: IntegrationVault; changed: boolean } {
  const notion = vault.notion;
  if (!notion?.accessToken) {
    return { vault, changed: false };
  }
  if (isMcpConnection(notion)) {
    return { vault, changed: false };
  }
  const { notion: _removed, ...rest } = vault;
  return { vault: { ...rest, ownerId: vault.ownerId }, changed: true };
}

/** Public status: only MCP connections count as connected. */
export function notionPublicConnected(vault: IntegrationVault): boolean {
  return isMcpConnection(vault.notion);
}

/**
 * Return a fresh MCP access token for this owner.
 * Refreshes when expired; returns updated NotionConnection when tokens rotated.
 * Legacy Integration OAuth tokens (no authKind:mcp) are ignored — user must reconnect.
 */
export async function getNotionMcpAccessToken(
  req: NextRequest,
  ownerId: string,
): Promise<{ token: string | null; updatedNotion?: NotionConnection }> {
  const vault = await readVault(req, ownerId);
  const notion = vault.notion;
  if (!isMcpConnection(notion)) {
    return { token: null };
  }

  const stillFresh =
    !notion.expiresAt || notion.expiresAt > Date.now() + 60_000;
  if (stillFresh) {
    return { token: notion.accessToken };
  }

  if (!notion.refreshToken) {
    return { token: null };
  }

  try {
    const clientId =
      notion.mcpClientId?.trim() || process.env.NOTION_MCP_CLIENT_ID?.trim() || '';
    if (!clientId) {
      // Without client_id refresh is unreliable — force reconnect.
      return { token: null };
    }
    const metadata = await discoverNotionMcpOAuthMetadata();
    const token = await refreshNotionMcpToken({
      tokenEndpoint: metadata.token_endpoint,
      refreshToken: notion.refreshToken,
      clientId,
    });
    const updated = notionConnectionFromMcpToken(token, notion, { mcpClientId: clientId });
    return { token: updated.accessToken, updatedNotion: updated };
  } catch {
    return { token: null };
  }
}

/** @deprecated Prefer getNotionMcpAccessToken — kept for call-site compatibility. */
export async function getNotionAccessToken(
  req: NextRequest,
  ownerId: string,
): Promise<string | null> {
  const { token } = await getNotionMcpAccessToken(req, ownerId);
  return token;
}
