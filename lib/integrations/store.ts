import type { NextRequest, NextResponse } from 'next/server';
import { decryptJson, encryptJson } from '@/lib/integrations/crypto';
import { integrationsSecret } from '@/lib/integrations/identity';
import {
  discoverNotionMcpOAuthMetadata,
  notionConnectionFromMcpToken,
  refreshNotionMcpToken,
} from '@/lib/integrations/notion-mcp-oauth';
import {
  GOOGLE_INTEGRATION_COOKIE,
  INTEGRATIONS_COOKIE,
  type IntegrationVault,
  type NotionConnection,
  type GitHubConnection,
  type GoogleConnection,
} from '@/lib/integrations/types';

type GoogleVault = {
  ownerId: string;
  google: GoogleConnection;
};

const secureCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 90,
};

export async function readVault(
  req: NextRequest,
  ownerId: string,
): Promise<IntegrationVault> {
  const secret = integrationsSecret();
  const raw = req.cookies.get(INTEGRATIONS_COOKIE)?.value || '';
  const base = raw
    ? await decryptJson<IntegrationVault>(raw, secret)
    : null;
  const vault: IntegrationVault = base?.ownerId === ownerId ? base : { ownerId };

  const googleRaw = req.cookies.get(GOOGLE_INTEGRATION_COOKIE)?.value || '';
  if (!googleRaw) return vault;
  const googleVault = await decryptJson<GoogleVault>(googleRaw, secret);
  if (!googleVault || googleVault.ownerId !== ownerId) return vault;
  return { ...vault, ownerId, google: googleVault.google };
}

export async function writeVaultCookie(
  response: NextResponse,
  vault: IntegrationVault,
): Promise<void> {
  const secret = integrationsSecret();
  const { google: _google, ...baseVault } = vault;
  const value = await encryptJson(baseVault, secret);
  response.cookies.set({
    name: INTEGRATIONS_COOKIE,
    value,
    ...secureCookieOptions,
  });
}

/** Persist a compact Google connection (prefer refresh token; drop bulky access token if needed). */
function compactGoogleConnection(google: GoogleConnection): GoogleConnection {
  const compact: GoogleConnection = {
    authKind: 'oauth',
    accessToken: google.accessToken || '',
    refreshToken: google.refreshToken,
    expiresAt: google.expiresAt,
    tokenType: google.tokenType || 'Bearer',
    // scopes string can be long; not required after connect
    scope: undefined,
    email: google.email,
    connectedAt: google.connectedAt,
  };
  return compact;
}

async function writeGoogleCookie(
  response: NextResponse,
  ownerId: string,
  google: GoogleConnection,
): Promise<void> {
  const secret = integrationsSecret();
  let toStore = compactGoogleConnection(google);
  let value = await encryptJson({ ownerId, google: toStore } satisfies GoogleVault, secret);
  // Browsers reject cookies roughly above 4KB; keep well under that.
  if (value.length > 3500 && toStore.refreshToken) {
    toStore = { ...toStore, accessToken: '', expiresAt: 0 };
    value = await encryptJson({ ownerId, google: toStore } satisfies GoogleVault, secret);
  }
  if (value.length > 3500) {
    throw new Error(`Google cookie too large (${value.length} bytes). Disconnect Notion/GitHub and retry.`);
  }
  response.cookies.set({
    name: GOOGLE_INTEGRATION_COOKIE,
    value,
    ...secureCookieOptions,
  });
}

function clearGoogleCookie(response: NextResponse): void {
  response.cookies.set({
    name: GOOGLE_INTEGRATION_COOKIE,
    value: '',
    ...secureCookieOptions,
    maxAge: 0,
  });
}

export function clearVaultCookie(response: NextResponse): void {
  response.cookies.set({
    name: INTEGRATIONS_COOKIE,
    value: '',
    ...secureCookieOptions,
    maxAge: 0,
  });
  clearGoogleCookie(response);
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
  await writeGoogleCookie(response, ownerId, google);
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
  clearGoogleCookie(response);
  return next;
}

/** Public status: OAuth connection with access or refresh token counts as connected. */
export function googlePublicConnected(vault: IntegrationVault): boolean {
  const g = vault.google;
  return Boolean(g?.authKind === 'oauth' && (g.accessToken || g.refreshToken));
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
  if (!google || google.authKind !== 'oauth') return { token: null };
  if (!google.accessToken && !google.refreshToken) return { token: null };

  const stillFresh =
    Boolean(google.accessToken) &&
    (!google.expiresAt || google.expiresAt > Date.now() + 60_000);
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
  } catch (err: unknown) {
    console.warn(
      'Google access token refresh failed:',
      err instanceof Error ? err.message : err,
    );
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
