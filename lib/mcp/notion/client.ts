/**
 * Notion MCP client — thin wrapper around shared HTTP MCP transport.
 */

import { McpHttpClient, type McpToolDefinition } from '@/lib/mcp/http-client';
import { NOTION_MCP_SERVER_URL } from '@/lib/integrations/notion/oauth';

export type { McpToolDefinition };

export class NotionMcpClient {
  private readonly client: McpHttpClient;

  constructor(accessToken: string) {
    this.client = new McpHttpClient({
      serverUrl: NOTION_MCP_SERVER_URL,
      accessToken,
      userAgent: 'ChristmasChat-NotionMCP/1.0',
    });
  }

  async listTools(): Promise<McpToolDefinition[]> {
    return this.client.listTools();
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError?: boolean }> {
    return this.client.callTool(name, args);
  }

  async fetchSelfLabel(): Promise<{ workspaceName?: string; userName?: string }> {
    try {
      const { content } = await this.callTool('notion-fetch', { id: 'self' });
      const parsed = JSON.parse(content) as {
        self?: {
          workspace?: { name?: string };
          user?: { name?: string };
        };
      };
      return {
        workspaceName: parsed?.self?.workspace?.name,
        userName: parsed?.self?.user?.name,
      };
    } catch {
      return {};
    }
  }
}

export async function listNotionMcpTools(
  accessToken: string,
): Promise<McpToolDefinition[]> {
  const client = new NotionMcpClient(accessToken);
  return client.listTools();
}

export async function callNotionMcpTool(
  accessToken: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError?: boolean }> {
  const client = new NotionMcpClient(accessToken);
  return client.callTool(name, args);
}
