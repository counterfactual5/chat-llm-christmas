import type { NextRequest, NextResponse } from 'next/server';
import { decryptJson, encryptJson } from '@/lib/integrations/crypto';
import { integrationsSecret } from '@/lib/integrations/identity';
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

/** Server-only: return the current user's Notion access token, or null. */
export async function getNotionAccessToken(
  req: NextRequest,
  ownerId: string,
): Promise<string | null> {
  const vault = await readVault(req, ownerId);
  return vault.notion?.accessToken || null;
}
