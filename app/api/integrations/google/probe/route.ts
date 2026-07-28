import { NextRequest, NextResponse } from 'next/server';
import {
  getGoogleAccessToken,
  GOOGLE_MCP_SERVERS,
  resolveOwnerId,
} from '@/lib/integrations';
import { callMcpTool, listMcpTools } from '@/lib/mcp/http-client';

export const runtime = 'edge';
export const maxDuration = 30;

type ProbeResult = {
  service: 'gmail' | 'calendar' | 'drive';
  ok: boolean;
  toolCount?: number;
  checkTool?: string;
  error?: string;
};

const CHECKS = {
  gmail: { tool: 'list_labels', args: {} },
  calendar: { tool: 'list_calendars', args: {} },
  drive: { tool: 'list_recent_files', args: { pageSize: 1 } },
} as const;

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err || 'Unknown error')).slice(0, 300);
}

export async function GET(req: NextRequest) {
  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const { token } = await getGoogleAccessToken(req, ownerId);
  if (!token) {
    return NextResponse.json({ error: 'Google OAuth token unavailable.' }, { status: 401 });
  }

  const results: ProbeResult[] = [];
  for (const service of Object.keys(CHECKS) as Array<keyof typeof CHECKS>) {
    const opts = {
      serverUrl: GOOGLE_MCP_SERVERS[service].url,
      accessToken: token,
      userAgent: 'ChristmasChat-GoogleMCP-Probe/1.0',
    };
    try {
      const tools = await listMcpTools(opts);
      const check = CHECKS[service];
      if (!tools.some((tool) => tool.name === check.tool)) {
        results.push({
          service,
          ok: false,
          toolCount: tools.length,
          error: `Expected tool ${check.tool} is missing.`,
        });
        continue;
      }
      const outcome = await callMcpTool(opts, check.tool, { ...check.args });
      results.push({
        service,
        ok: !outcome.isError,
        toolCount: tools.length,
        checkTool: check.tool,
        error: outcome.isError ? outcome.content.slice(0, 300) : undefined,
      });
    } catch (err: unknown) {
      results.push({ service, ok: false, error: errorMessage(err) });
    }
  }

  return NextResponse.json({
    connected: true,
    usable: results.some((result) => result.ok),
    allUsable: results.every((result) => result.ok),
    results,
  });
}
