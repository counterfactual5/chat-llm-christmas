import { NextRequest } from 'next/server';
import { getNotionMcpAccessToken, resolveOwnerId } from '@/lib/integrations';
import { NotionMcpClient } from '@/lib/mcp/notion/client';
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

  const { token } = await getNotionMcpAccessToken(req, ownerId);
  if (!token) {
    return probeTokenUnavailable('Notion MCP token unavailable.');
  }

  try {
    const tools = await new NotionMcpClient(token).listTools();
    return probeOk({
      usable: Array.isArray(tools),
      mode: 'mcp',
      results: [{ service: 'notion-mcp', ok: true, toolCount: tools.length }],
    });
  } catch (err: unknown) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    const authFail = /401|unauthorized|invalid.?token|expired|forbidden/i.test(message);
    return probeOk({
      usable: false,
      mode: 'mcp',
      results: [{ service: 'notion-mcp', ok: false, error: message }],
      ...(authFail
        ? undefined
        : { hint: 'Notion MCP probe failed — reconnect Notion if this persists.' }),
    });
  }
}
