/**
 * Integration vault store — public barrel.
 *
 *  vault.ts   cookie + remote vault read/write/hydrate/forget
 *  notion.ts  Notion MCP connection + token refresh
 *  github.ts  GitHub OAuth connection + token
 *  google.ts  Google OAuth connection + token refresh
 */

export {
  readVaultDetailed,
  readVault,
  hydrateVaultCookies,
  writeVaultCookie,
  clearVaultCookie,
  forgetOwnerIntegrations,
} from '@/lib/integrations/store/vault';

export {
  upsertNotionConnection,
  removeNotionConnection,
  purgeLegacyNotionFromVault,
  notionPublicConnected,
  getNotionMcpAccessToken,
  getNotionAccessToken,
} from '@/lib/integrations/store/notion';

export {
  upsertGitHubConnection,
  removeGitHubConnection,
  githubPublicConnected,
  getGitHubAccessToken,
} from '@/lib/integrations/store/github';

export {
  upsertGoogleConnection,
  removeGoogleConnection,
  googlePublicConnected,
  getGoogleAccessToken,
} from '@/lib/integrations/store/google';
