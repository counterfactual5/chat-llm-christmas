/** Gateway base URL + routing-model resolution shared by upload helpers. */

export function gatewayBaseURL() {
  return (process.env.LLM_CHRISTMAS_BASE_URL || 'https://api.llm.christmas/v1').replace(
    /\/$/,
    '',
  );
}

export function resolveUploadModel(explicit?: string): string {
  return (
    String(explicit || process.env.LLM_CHRISTMAS_FILE_MODEL || 'gpt-4o').trim() || 'gpt-4o'
  );
}
