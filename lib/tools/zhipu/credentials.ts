/**
 * Zhipu GLM Coding Plan credentials.
 * Still used by image_understand on Christmas; web search/read MCP keys live on chat-api.
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
