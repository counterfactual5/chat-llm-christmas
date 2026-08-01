/** Gateway base URL + routing-model resolution shared by upload helpers. */

import { chatBackendV1 } from '@/lib/chat-backend';

/** LLM / OpenAI-compatible gateway (chat completions, image generation). */
export function gatewayBaseURL() {
  return (process.env.LLM_CHRISTMAS_BASE_URL || 'https://api.llm.christmas/v1').replace(
    /\/$/,
    '',
  );
}

/** Account file storage on chat-api (not the LLM gateway). */
export function filesGatewayBaseURL() {
  return (process.env.CHAT_FILES_BASE_URL || chatBackendV1()).replace(/\/$/, '');
}

export function resolveUploadModel(explicit?: string): string {
  return (
    String(explicit || process.env.LLM_CHRISTMAS_FILE_MODEL || 'gpt-4o').trim() || 'gpt-4o'
  );
}
