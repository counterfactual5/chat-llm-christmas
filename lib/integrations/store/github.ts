/**
 * GitHub connection upsert/remove + access token helpers.
 */

import type { NextRequest, NextResponse } from 'next/server';
import {
  persistVault,
  readVault,
} from '@/lib/integrations/store/vault';
import type { GitHubConnection, IntegrationVault } from '@/lib/integrations/types';

export async function upsertGitHubConnection(
  req: NextRequest,
  response: NextResponse,
  ownerId: string,
  github: GitHubConnection,
): Promise<IntegrationVault> {
  const vault = await readVault(req, ownerId);
  return persistVault(response, ownerId, { ...vault, ownerId, github });
}

export async function removeGitHubConnection(
  req: NextRequest,
  response: NextResponse,
  ownerId: string,
): Promise<IntegrationVault> {
  const vault = await readVault(req, ownerId);
  const { github: _removed, ...rest } = vault;
  return persistVault(response, ownerId, { ...rest, ownerId });
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
