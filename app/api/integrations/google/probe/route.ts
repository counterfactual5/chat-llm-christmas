import { NextRequest } from 'next/server';
import { getGoogleAccessToken, resolveOwnerId } from '@/lib/integrations';
import { probeGoogleApis } from '@/lib/integrations/google/rest';
import {
  probeAuthRequired,
  probeOk,
  probeTokenUnavailable,
} from '@/lib/integrations/oauth-probe';

export const runtime = 'edge';
export const maxDuration = 30;

const GCP_ENABLE_HINT =
  'In the GCP project that owns GOOGLE_OAUTH_CLIENT_ID, enable: gmail.googleapis.com, calendar-json.googleapis.com, drive.googleapis.com. Then reconnect Google in chat settings if needed.';

export async function GET(req: NextRequest) {
  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    return probeAuthRequired('Not authenticated.');
  }

  const { token } = await getGoogleAccessToken(req, ownerId);
  if (!token) {
    return probeTokenUnavailable('Google OAuth token unavailable.');
  }

  const results = await probeGoogleApis(token);
  const usable = results.some((result) => result.ok);
  const forbidden = results.some((result) =>
    /permission|access not configured|has not been used|disabled|API has not been/i.test(
      result.error || '',
    ),
  );

  return probeOk({
    usable,
    mode: 'rest',
    allUsable: results.every((result) => result.ok),
    results,
    ...(forbidden && !usable ? { hint: GCP_ENABLE_HINT } : {}),
  });
}
