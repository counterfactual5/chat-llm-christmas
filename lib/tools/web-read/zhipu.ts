/**
 * Zhipu Coding Plan MCP backend for web page reading.
 */

import {
  ZHIPU_MCP_READER_URL,
  createZhipuMcpClient,
  parseMaybeJson,
  resolveToolName,
} from '@/lib/tools/zhipu/mcp-helpers';

export type ZhipuMcpReadResult = {
  url: string;
  title?: string;
  description?: string;
  content: string;
};

/**
 * Call Coding Plan web reader MCP (`webReader` / `web_reader`).
 * Returns page markdown/text; throws on MCP / tool errors.
 */
export async function zhipuMcpWebRead(url: string): Promise<ZhipuMcpReadResult> {
  const client = createZhipuMcpClient(ZHIPU_MCP_READER_URL);
  const toolName = await resolveToolName(client, ['web_reader', 'webReader']);

  const { content, isError } = await client.callTool(toolName, {
    url: String(url || '').trim(),
  });
  if (isError) throw new Error(content.slice(0, 300) || `${toolName} failed`);

  const parsed = parseMaybeJson(content);
  if (typeof parsed === 'string') {
    const text = parsed.trim();
    if (!text) throw new Error(`Zhipu MCP ${toolName} returned empty content`);
    return { url, content: text };
  }

  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const nested =
    obj.reader_result && typeof obj.reader_result === 'object'
      ? (obj.reader_result as Record<string, unknown>)
      : obj;
  const body = String(
    nested.content || nested.text || nested.markdown || obj.content || '',
  ).trim();
  if (!body) throw new Error(`Zhipu MCP ${toolName} returned empty content`);

  return {
    url: String(nested.url || obj.url || url),
    title: nested.title ? String(nested.title) : undefined,
    description: nested.description ? String(nested.description) : undefined,
    content: body,
  };
}
