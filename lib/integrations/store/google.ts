/**
 * Google connection upsert/remove + access token refresh helpers.
 */

import type { NextRequest, NextResponse } from 'next/server';
import {
  clearGoogleCookie,
  readVault,
  writeGoogleCookie,
  writeVaultCookie,
} from '@/lib/integrations/store/vault';
import { writeRemoteVault } from '@/lib/integrations/remote-store';
import type { GoogleConnection, IntegrationVault } from '@/lib/integrations/types';

export async function upsertGoogleConnection(
  req: NextRequest,
  response: NextResponse,
  ownerId: string,
  google: GoogleConnection,
): Promise<IntegrationVault> {
  const vault = await readVault(req, ownerId);
  const next: IntegrationVault = { ...vault, ownerId, google };
  await writeGoogleCookie(response, ownerId, google);
  await writeRemoteVault(ownerId, next);
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
  await writeRemoteVault(ownerId, next);
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
      '@/lib/integrations/google/oauth'
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
