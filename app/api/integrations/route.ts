import { NextRequest, NextResponse } from 'next/server';
import {
  notionOAuthConfigured,
  readVault,
  resolveOwnerId,
  type IntegrationPublicStatus,
} from '@/lib/integrations';

export const runtime = 'edge';
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    return NextResponse.json({ error: 'Connect your llm.christmas account first.' }, { status: 401 });
  }

  const vault = await readVault(req, ownerId);
  const notionAvailable = notionOAuthConfigured();
  const integrations: IntegrationPublicStatus[] = [
    {
      provider: 'notion',
      available: notionAvailable,
      connected: Boolean(vault.notion?.accessToken),
      label: vault.notion?.workspaceName || undefined,
      connectedAt: vault.notion?.connectedAt,
    },
  ];

  return NextResponse.json({ integrations });
}
