/**
 * Product backend (chat-api) — sessions / skills / memories / files / research.
 * Distinct from the LLM gateway (api.llm.christmas) and the platform portal (llm.christmas).
 */

export function chatBackendOrigin(): string {
  return (
    process.env.CHAT_BACKEND_BASE || 'https://api.chat.llm.christmas'
  ).replace(/\/$/, '');
}

/** OpenAI-style files + product JSON under /v1 */
export function chatBackendV1(): string {
  return `${chatBackendOrigin()}/v1`;
}

export function chatBackendSessionsURL(): string {
  return `${chatBackendV1()}/sessions`;
}

export function chatBackendSkillsURL(): string {
  return `${chatBackendV1()}/skills`;
}

export function chatBackendMemoriesURL(): string {
  return `${chatBackendV1()}/memories`;
}

export function chatBackendResearchURL(jobId?: string): string {
  const base = `${chatBackendV1()}/research`;
  return jobId ? `${base}/${encodeURIComponent(jobId)}` : base;
}

export function chatBackendLiteratureURL(path = ''): string {
  const base = `${chatBackendV1()}/literature`;
  const suffix = String(path || '').replace(/^\/+/, '');
  return suffix ? `${base}/${suffix}` : base;
}

export function chatBackendToolsURL(path = ''): string {
  const base = `${chatBackendV1()}/tools`;
  const suffix = String(path || '').replace(/^\/+/, '');
  return suffix ? `${base}/${suffix}` : base;
}
