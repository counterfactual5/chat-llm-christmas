import { NextRequest, NextResponse } from 'next/server';
import { removeGitHubConnection, resolveOwnerId } from '@/lib/integrations';

export const runtime = 'edge';
export const maxDuration = 20;

export async function DELETE(req: NextRequest) {
  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const response = NextResponse.json({ connected: false, provider: 'github' });
  await removeGitHubConnection(req, response, ownerId);
  return response;
}
