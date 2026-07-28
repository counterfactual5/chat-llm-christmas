import { NextRequest, NextResponse } from 'next/server';
import {
  notionMcpOAuthConfigured,
  notionPublicConnected,
  purgeLegacyNotionFromVault,
  readVault,
  resolveOwnerId,
  writeVaultCookie,
  githubOAuthConfigured,
  githubPublicConnected,
} from '@/lib/integrations';
import type { IntegrationPublicStatus } from '@/lib/integrations';

export const runtime = 'edge';
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let vault = await readVault(req, ownerId);
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
  ];

  const response = NextResponse.json({ integrations });
  if (purged.changed) {
    await writeVaultCookie(response, vault);
  }
  return response;
}
