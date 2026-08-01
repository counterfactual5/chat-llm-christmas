import { beforeEach, describe, expect, it, vi } from 'vitest';

const integrationMocks = vi.hoisted(() => ({
  normalizeGoogleIntegrations: vi.fn((ids: string[]) => ids),
  enabledGoogleServices: vi.fn((ids: string[]) =>
    ids.filter((id) => ['gmail', 'google-calendar', 'google-drive'].includes(id)),
  ),
  wantsGoogleToken: vi.fn((ids: string[]) => ids.some((id) => id.startsWith('google') || id === 'gmail')),
  resolveOwnerId: vi.fn(),
  getNotionMcpAccessToken: vi.fn(),
  getGitHubAccessToken: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('@/lib/integrations', () => integrationMocks);

import { resolveAuthorizedIntegrations } from '@/lib/chat/server/credentials';

describe('resolveAuthorizedIntegrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    integrationMocks.resolveOwnerId.mockResolvedValue('owner-1');
    integrationMocks.getNotionMcpAccessToken.mockResolvedValue({
      token: 'notion-token',
      updatedNotion: { accessToken: 'notion-token' },
    });
    integrationMocks.getGitHubAccessToken.mockResolvedValue('github-token');
    integrationMocks.getGoogleAccessToken.mockResolvedValue({
      token: 'google-token',
      updatedGoogle: { accessToken: 'google-token' },
    });
  });

  it('only enables requested integrations whose credentials resolve', async () => {
    const result = await resolveAuthorizedIntegrations({
      req: {} as never,
      integrations: ['notion', 'github', 'gmail', 'google-drive', 'zhipu-vision'],
      isBoundAccount: true,
      boundUserKey: 'user-key',
    });

    expect(result.authorizedIntegrations).toEqual([
      'notion',
      'github',
      'gmail',
      'google-drive',
      'zhipu-vision',
    ]);
    expect(result).toMatchObject({
      notionAccessToken: 'notion-token',
      githubAccessToken: 'github-token',
      googleAccessToken: 'google-token',
      notionOwnerId: 'owner-1',
      googleOwnerId: 'owner-1',
      googleRequestedButUnauthorized: false,
    });
    expect(integrationMocks.resolveOwnerId).toHaveBeenCalledTimes(1);
  });

  it('does not resolve OAuth credentials for an unbound account', async () => {
    const result = await resolveAuthorizedIntegrations({
      req: {} as never,
      integrations: ['notion', 'gmail', 'zhipu-vision'],
      isBoundAccount: false,
      boundUserKey: '',
    });

    expect(result.authorizedIntegrations).toEqual([]);
    expect(result.googleRequestedButUnauthorized).toBe(true);
    expect(integrationMocks.resolveOwnerId).not.toHaveBeenCalled();
    expect(integrationMocks.getNotionMcpAccessToken).not.toHaveBeenCalled();
    expect(integrationMocks.getGoogleAccessToken).not.toHaveBeenCalled();
  });
});
