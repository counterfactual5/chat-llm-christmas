import type { NextRequest, NextResponse } from 'next/server';
import { decryptJson, encryptJson } from '@/lib/integrations/crypto';
import { integrationsSecret } from '@/lib/integrations/identity';
import {
  discoverNotionMcpOAuthMetadata,
  notionConnectionFromMcpToken,
  refreshNotionMcpToken,
} from '@/lib/integrations/notion-mcp-oauth';
import {
  INTEGRATIONS_COOKIE,
  type IntegrationVault,
  type NotionConnection,
} from '@/lib/integrations/types';

export async function readVault(
  req: NextRequest,
  ownerId: string,
): Promise<IntegrationVault> {
  const raw = req.cookies.get(INTEGRATIONS_COOKIE)?.value || '';
  if (!raw) return { ownerId };
  const secret = integrationsSecret();
  const vault = await decryptJson<IntegrationVault>(raw, secret);
  if (!vault || vault.ownerId !== ownerId) return { ownerId };
  return vault;
}

export async function writeVaultCookie(
  response: NextResponse,
  vault: IntegrationVault,
): Promise<void> {
  const secret = integrationsSecret();
  const value = await encryptJson(vault, secret);
  response.cookies.set({
    name: INTEGRATIONS_COOKIE,
    value,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
  });
}

export function clearVaultCookie(response: NextResponse): void {
  response.cookies.set({
    name: INTEGRATIONS_COOKIE,
    value: '',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export async function upsertNotionConnection(
  req: NextRequest,
  response: NextResponse,
  ownerId: string,
  notion: NotionConnection,
): Promise<IntegrationVault> {
  const vault = await readVault(req, ownerId);
  const next: IntegrationVault = { ...vault, ownerId, notion };
  await writeVaultCookie(response, next);
  return next;
}

export async function removeNotionConnection(
  req: NextRequest,
  response: NextResponse,
  ownerId: string,
): Promise<IntegrationVault> {
  const next: IntegrationVault = { ownerId };
  await writeVaultCookie(response, next);
  return next;
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
