/**
 * Integration vault cookie + remote persistence.
 * Provider upsert/token helpers live in ./notion, ./github, ./google.
 */

import type { NextRequest, NextResponse } from 'next/server';
import { decryptJson, encryptJson } from '@/lib/integrations/crypto';
import { integrationsSecret } from '@/lib/integrations/identity';
import {
  deleteRemoteVault,
  readRemoteVault,
  remoteVaultConfigured,
  writeRemoteVault,
} from '@/lib/integrations/remote-store';
import {
  GOOGLE_INTEGRATION_COOKIE,
  INTEGRATIONS_COOKIE,
  type IntegrationVault,
  type GoogleConnection,
} from '@/lib/integrations/types';

type GoogleVault = {
  ownerId: string;
  google: GoogleConnection;
};

/** Browser cache aligned with API key (~30d). Long-lived copy lives in remote KV. */
const secureCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
};

function hasAnyConnection(vault: IntegrationVault): boolean {
  return Boolean(vault.notion || vault.github || vault.google);
}

async function readCookieVault(
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

/**
 * Vault for this owner, plus whether it came from the server-side store.
 * Cookies stay the fast path; the remote store is only consulted when this
 * browser has nothing for the owner (fresh login, new device, cleared cookies).
 */
export async function readVaultDetailed(
  req: NextRequest,
  ownerId: string,
): Promise<{ vault: IntegrationVault; fromRemote: boolean }> {
  const cookieVault = await readCookieVault(req, ownerId);
  if (hasAnyConnection(cookieVault) || !remoteVaultConfigured()) {
    return { vault: cookieVault, fromRemote: false };
  }
  const remote = await readRemoteVault(ownerId);
  if (!remote || !hasAnyConnection(remote)) {
    return { vault: cookieVault, fromRemote: false };
  }
  return { vault: { ...remote, ownerId }, fromRemote: true };
}

export async function readVault(
  req: NextRequest,
  ownerId: string,
): Promise<IntegrationVault> {
  const { vault } = await readVaultDetailed(req, ownerId);
  return vault;
}

/**
 * Write a vault restored from the server-side store back into cookies, so
 * subsequent requests in this browser skip the remote round trip.
 */
export async function hydrateVaultCookies(
  response: NextResponse,
  vault: IntegrationVault,
): Promise<void> {
  await writeVaultCookie(response, vault);
  if (vault.google) {
    try {
      await writeGoogleCookie(response, vault.ownerId, vault.google);
    } catch (err: unknown) {
      console.warn(
        'integrations: google cookie hydrate skipped:',
        err instanceof Error ? err.message : err,
      );
    }
  }
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

export async function writeGoogleCookie(
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

export function clearGoogleCookie(response: NextResponse): void {
  response.cookies.set({
    name: GOOGLE_INTEGRATION_COOKIE,
    value: '',
    ...secureCookieOptions,
    maxAge: 0,
  });
}

/**
 * Drop this browser's copy of the vault. The server-side store is untouched:
 * signing back in with the same account restores the connections. Use
 * `forgetOwnerIntegrations` for a real, irreversible disconnect.
 */
export function clearVaultCookie(response: NextResponse): void {
  response.cookies.set({
    name: INTEGRATIONS_COOKIE,
    value: '',
    ...secureCookieOptions,
    maxAge: 0,
  });
  clearGoogleCookie(response);
}

/** Cookie + server-side removal for one owner. */
export async function forgetOwnerIntegrations(
  response: NextResponse,
  ownerId: string,
): Promise<void> {
  clearVaultCookie(response);
  await deleteRemoteVault(ownerId);
}

/** Persist vault to cookie + remote (shared by provider upsert/remove). */
export async function persistVault(
  response: NextResponse,
  ownerId: string,
  vault: IntegrationVault,
): Promise<IntegrationVault> {
  const next = { ...vault, ownerId };
  await writeVaultCookie(response, next);
  await writeRemoteVault(ownerId, next);
  return next;
}
