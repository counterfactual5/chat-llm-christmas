/**
 * Resolve which integrations are both requested and OAuth-authorized.
 * Never trust client `integrations` alone — intersect with vault tokens.
 */

import type { NextRequest } from 'next/server';
import {
  enabledGoogleServices,
  getGitHubAccessToken,
  getGoogleAccessToken,
  getNotionMcpAccessToken,
  normalizeGoogleIntegrations,
  resolveOwnerId,
  wantsGoogleToken,
} from '@/lib/integrations';
import type { GoogleConnection, NotionConnection } from '@/lib/integrations/types';

export type AuthorizedIntegrationsResult = {
  requestedIntegrations: string[];
  authorizedIntegrations: string[];
  notionAccessToken: string | undefined;
  githubAccessToken: string | undefined;
  googleAccessToken: string | undefined;
  notionOwnerId: string | null;
  googleOwnerId: string | null;
  notionVaultUpdate: NotionConnection | undefined;
  googleVaultUpdate: GoogleConnection | undefined;
  googleRequestedButUnauthorized: boolean;
  notionRequestedButUnauthorized: boolean;
  githubRequestedButUnauthorized: boolean;
};

export async function resolveAuthorizedIntegrations(opts: {
  req: NextRequest;
  integrations: string[];
  isBoundAccount: boolean;
  boundUserKey: string;
}): Promise<AuthorizedIntegrationsResult> {
  const { req, isBoundAccount, boundUserKey } = opts;
  const requestedIntegrations = normalizeGoogleIntegrations(opts.integrations);

  // Intersect client toggles with vault OAuth — never trust integrations alone.
  const authorizedIntegrations: string[] = [];
  let notionAccessToken: string | undefined;
  let githubAccessToken: string | undefined;
  let googleAccessToken: string | undefined;
  let notionOwnerId: string | null = null;
  let googleOwnerId: string | null = null;
  let notionVaultUpdate: NotionConnection | undefined;
  let googleVaultUpdate: GoogleConnection | undefined;

  if (requestedIntegrations.includes('notion') && isBoundAccount) {
    notionOwnerId = await resolveOwnerId(req);
    if (notionOwnerId) {
      const mcp = await getNotionMcpAccessToken(req, notionOwnerId);
      if (mcp.token) {
        authorizedIntegrations.push('notion');
        notionAccessToken = mcp.token;
        notionVaultUpdate = mcp.updatedNotion;
      }
    }
  }
  if (requestedIntegrations.includes('github') && isBoundAccount) {
    const ownerId = notionOwnerId ?? (await resolveOwnerId(req));
    if (ownerId) {
      const token = await getGitHubAccessToken(req, ownerId);
      if (token) {
        authorizedIntegrations.push('github');
        githubAccessToken = token;
      }
    }
  }
  const requestedGoogleServices = enabledGoogleServices(requestedIntegrations);
  if (requestedGoogleServices.length > 0 && isBoundAccount) {
    const ownerId = notionOwnerId ?? (await resolveOwnerId(req));
    if (ownerId) {
      const mcp = await getGoogleAccessToken(req, ownerId);
      if (mcp.token) {
        authorizedIntegrations.push(...requestedGoogleServices);
        googleAccessToken = mcp.token;
        googleVaultUpdate = mcp.updatedGoogle;
        googleOwnerId = ownerId;
      }
    }
  }
  // Zhipu Vision MCP: no OAuth — just needs a logged-in CPA account (user key).
  if (requestedIntegrations.includes('zhipu-vision') && isBoundAccount && boundUserKey) {
    authorizedIntegrations.push('zhipu-vision');
  }
  // Optional built-ins (Paper / Book / Generate Image): same — bound account only.
  for (const id of ['paper_search', 'book_search', 'generate_image'] as const) {
    if (requestedIntegrations.includes(id) && isBoundAccount && boundUserKey) {
      authorizedIntegrations.push(id);
    }
  }

  const googleRequestedButUnauthorized =
    wantsGoogleToken(requestedIntegrations) &&
    !enabledGoogleServices(authorizedIntegrations).length;
  const notionRequestedButUnauthorized =
    requestedIntegrations.includes('notion') &&
    !authorizedIntegrations.includes('notion');
  const githubRequestedButUnauthorized =
    requestedIntegrations.includes('github') &&
    !authorizedIntegrations.includes('github');

  return {
    requestedIntegrations,
    authorizedIntegrations,
    notionAccessToken,
    githubAccessToken,
    googleAccessToken,
    notionOwnerId,
    googleOwnerId,
    notionVaultUpdate,
    googleVaultUpdate,
    googleRequestedButUnauthorized,
    notionRequestedButUnauthorized,
    githubRequestedButUnauthorized,
  };
}
