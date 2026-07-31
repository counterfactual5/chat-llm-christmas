/**
 * Zhipu GLM Coding Plan credentials.
 * Shared by web search / web read MCP backends and image understand.
 */

export function zhipuApiKey(): string | undefined {
  return (
    process.env.ZHIPU_CODING_API_KEY?.trim() ||
    process.env.ZHIPU_API_KEY?.trim() ||
    process.env.ZHIPUAI_API_KEY?.trim() ||
    process.env.BIGMODEL_API_KEY?.trim() ||
    undefined
  );
}

/** Prefer Coding Plan MCP unless explicitly disabled. */
export function zhipuMcpEnabled(): boolean {
  if (!zhipuApiKey()) return false;
  const flag = (process.env.ZHIPU_MCP_ENABLED || '1').trim().toLowerCase();
  return flag !== '0' && flag !== 'false' && flag !== 'off';
}
