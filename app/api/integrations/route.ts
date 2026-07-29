import { NextRequest, NextResponse } from 'next/server';
import {
  hydrateVaultCookies,
  notionMcpOAuthConfigured,
  notionPublicConnected,
  purgeLegacyNotionFromVault,
  readVaultDetailed,
  resolveOwnerId,
  writeVaultCookie,
  githubOAuthConfigured,
  githubPublicConnected,
  googleOAuthConfigured,
  googlePublicConnected,
} from '@/lib/integrations';
import type { IntegrationPublicStatus } from '@/lib/integrations';

export const runtime = 'edge';
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const read = await readVaultDetailed(req, ownerId);
  let vault = read.vault;
  const purged = purgeLegacyNotionFromVault(vault);
  vault = purged.vault;

  const notionAvailable = notionMcpOAuthConfigured();
  const connected = notionPublicConnected(vault);
  const integrations: IntegrationPublicStatus[] = [
    {
      provider: 'notion',
      available: notionAvailable,
      connected,
      label: connected ? vault.notion?.workspaceName || undefined : undefined,
      connectedAt: connected ? vault.notion?.connectedAt : undefined,
    },
    {
      provider: 'github',
      available: githubOAuthConfigured(),
      connected: githubPublicConnected(vault),
      label: githubPublicConnected(vault)
        ? vault.github?.login
          ? `@${vault.github.login}`
          : 'GitHub'
        : undefined,
      connectedAt: githubPublicConnected(vault) ? vault.github?.connectedAt : undefined,
    },
    {
      provider: 'google',
      available: googleOAuthConfigured(),
      connected: googlePublicConnected(vault),
      label: googlePublicConnected(vault)
        ? vault.google?.email
          ? (vault.google.email as string)
          : 'Google'
        : undefined,
      connectedAt: googlePublicConnected(vault) ? vault.google?.connectedAt : undefined,
    },
  ];

  const response = NextResponse.json({ integrations });
  if (read.fromRemote) {
    // Restored after a fresh login / new device — seed the cookies so the rest
    // of this session (chat requests included) skips the remote lookup.
    await hydrateVaultCookies(response, vault);
  } else if (purged.changed) {
    await writeVaultCookie(response, vault);
  }
  return response;
}
