import { NextRequest } from 'next/server';
import { getGitHubAccessToken, resolveOwnerId } from '@/lib/integrations';
import { fetchGitHubLogin } from '@/lib/integrations/github/oauth';
import {
  probeAuthRequired,
  probeOk,
  probeTokenUnavailable,
} from '@/lib/integrations/oauth-probe';

export const runtime = 'edge';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    return probeAuthRequired('Not authenticated.');
  }

  const token = await getGitHubAccessToken(req, ownerId);
  if (!token) {
    return probeTokenUnavailable('GitHub OAuth token unavailable.');
  }

  const login = await fetchGitHubLogin(token);
  if (!login) {
    return probeOk({
      usable: false,
      mode: 'rest',
      results: [{ service: 'github-user', ok: false, error: 'api.github.com/user failed' }],
    });
  }

  return probeOk({
    usable: true,
    mode: 'rest',
    results: [{ service: 'github-user', ok: true, login }],
  });
}
