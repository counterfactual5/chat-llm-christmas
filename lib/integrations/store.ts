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
  type GitHubConnection,
  type GoogleConnection,
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
  const vault = await readVault(req, ownerId);
  const { notion: _removed, ...rest } = vault;
  const next: IntegrationVault = { ...rest, ownerId };
  await writeVaultCookie(response, next);
  return next;
}

export async function upsertGitHubConnection(
  req: NextRequest,
  response: NextResponse,
  ownerId: string,
  github: GitHubConnection,
): Promise<IntegrationVault> {
  const vault = await readVault(req, ownerId);
  const next: IntegrationVault = { ...vault, ownerId, github };
  await writeVaultCookie(response, next);
  return next;
}

export async function removeGitHubConnection(
  req: NextRequest,
  response: NextResponse,
  ownerId: string,
): Promise<IntegrationVault> {
  const vault = await readVault(req, ownerId);
  const { github: _removed, ...rest } = vault;
  const next: IntegrationVault = { ...rest, ownerId };
  await writeVaultCookie(response, next);
  return next;
}

export async function upsertGoogleConnection(
  req: NextRequest,
  response: NextResponse,
  ownerId: string,
  google: GoogleConnection,
): Promise<IntegrationVault> {
  const vault = await readVault(req, ownerId);
  const next: IntegrationVault = { ...vault, ownerId, google };
  await writeVaultCookie(response, next);
  return next;
}

export async function removeGoogleConnection(
  req: NextRequest,
  response: NextResponse,
  ownerId: string,
): Promise<IntegrationVault> {
  const vault = await readVault(req, ownerId);
  const { google: _removed, ...rest } = vault;
  const next: IntegrationVault = { ...rest, ownerId };
  await writeVaultCookie(response, next);
  return next;
}

/** Public status: only OAuth connections (with access token) count as connected. */
export function googlePublicConnected(vault: IntegrationVault): boolean {
  return Boolean(vault.google?.accessToken && vault.google.authKind === 'oauth');
}

/**
 * Return a fresh Google access token for this owner.
 * Refreshes with the long-lived refresh token when expired.
 */
export async function getGoogleAccessToken(
  req: NextRequest,
  ownerId: string,
): Promise<{ token: string | null; updatedGoogle?: GoogleConnection }> {
  const vault = await readVault(req, ownerId);
  const google = vault.google;
  if (!google?.accessToken || google.authKind !== 'oauth') return { token: null };

  const stillFresh = !google.expiresAt || google.expiresAt > Date.now() + 60_000;
  if (stillFresh) return { token: google.accessToken };

  if (!google.refreshToken) return { token: null };

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return { token: null };

  try {
    const { refreshGoogleToken, googleConnectionFromToken } = await import(
      '@/lib/integrations/google-oauth'
    );
    const token = await refreshGoogleToken({
      refreshToken: google.refreshToken,
      clientId,
      clientSecret,
    });
    const updated = googleConnectionFromToken(token, google.email, google);
    return { token: updated.accessToken, updatedGoogle: updated };
  } catch {
    return { token: null };
  }
}

export function githubPublicConnected(vault: IntegrationVault): boolean {
  return Boolean(vault.github?.accessToken && vault.github.authKind === 'oauth');
}

export async function getGitHubAccessToken(
  req: NextRequest,
  ownerId: string,
): Promise<string | null> {
  const vault = await readVault(req, ownerId);
  const github = vault.github;
  if (!github?.accessToken || github.authKind !== 'oauth') return null;
  return github.accessToken;
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
