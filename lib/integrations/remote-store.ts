/**
 * Server-side integration vault keyed by owner id, so MCP connections follow
 * the account instead of the browser cookie.
 *
 * Storage is any Upstash-compatible Redis REST endpoint (Vercel KV included):
 * set `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` +
 * `UPSTASH_REDIS_REST_TOKEN`). Without them every call is a no-op and the
 * cookie vault remains the only store — same behaviour as before.
 *
 * Values are the same AES-GCM blobs used for the cookie, so tokens stay
 * encrypted at rest and are useless without INTEGRATIONS_ENCRYPTION_KEY.
 */

import { decryptJson, encryptJson } from '@/lib/integrations/crypto';
import { integrationsSecret } from '@/lib/integrations/identity';
import type { IntegrationVault } from '@/lib/integrations/types';

const TTL_SECONDS = 60 * 60 * 24 * 180;

function kvConfig(): { url: string; token: string } | null {
  const url = (
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    ''
  )
    .trim()
    .replace(/\/$/, '');
  const token = (
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    ''
  ).trim();
  if (!url || !token) return null;
  return { url, token };
}

export function remoteVaultConfigured(): boolean {
  return kvConfig() !== null;
}

function vaultKey(ownerId: string): string {
  return `llm_chat_integrations:v1:${ownerId}`;
}

async function kvFetch(
  path: string,
  init?: { method?: string; body?: string },
): Promise<unknown | null> {
  const config = kvConfig();
  if (!config) return null;
  try {
    const res = await fetch(`${config.url}/${path}`, {
      method: init?.method || 'GET',
      headers: { Authorization: `Bearer ${config.token}` },
      body: init?.body,
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn(`integrations remote store: ${path} failed (${res.status})`);
      return null;
    }
    const payload = (await res.json()) as { result?: unknown };
    return payload?.result ?? null;
  } catch (err: unknown) {
    console.warn(
      'integrations remote store unreachable:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Vault stored for this owner, or null when unconfigured / absent / undecryptable. */
export async function readRemoteVault(
  ownerId: string,
): Promise<IntegrationVault | null> {
  if (!ownerId || !remoteVaultConfigured()) return null;
  const result = await kvFetch(`get/${encodeURIComponent(vaultKey(ownerId))}`);
  if (typeof result !== 'string' || !result) return null;
  const vault = await decryptJson<IntegrationVault>(result, integrationsSecret());
  if (!vault || vault.ownerId !== ownerId) return null;
  return vault;
}

/** Mirror the vault server-side. Best-effort — never fails the caller. */
export async function writeRemoteVault(
  ownerId: string,
  vault: IntegrationVault,
): Promise<void> {
  if (!ownerId || !remoteVaultConfigured()) return;
  const hasConnection = Boolean(vault.notion || vault.github || vault.google);
  if (!hasConnection) {
    await deleteRemoteVault(ownerId);
    return;
  }
  try {
    const value = await encryptJson({ ...vault, ownerId }, integrationsSecret());
    await kvFetch(
      `set/${encodeURIComponent(vaultKey(ownerId))}?EX=${TTL_SECONDS}`,
      { method: 'POST', body: value },
    );
  } catch (err: unknown) {
    console.warn(
      'integrations remote store write skipped:',
      err instanceof Error ? err.message : err,
    );
  }
}

export async function deleteRemoteVault(ownerId: string): Promise<void> {
  if (!ownerId || !remoteVaultConfigured()) return;
  await kvFetch(`del/${encodeURIComponent(vaultKey(ownerId))}`, {
    method: 'POST',
  });
}
