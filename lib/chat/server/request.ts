/**
 * Chat API request body parsing and light validation.
 * Pure helpers — no cookie/OAuth side effects.
 */

export type ChatReviewToolRun = {
  name: string;
  status: string;
  query?: string;
  error?: string;
  provider?: string;
  results?: Array<{
    url?: string;
    title?: string;
    snippet?: string;
    body?: string;
  }>;
};

export type ChatReviewContext = {
  targetMessageId?: string;
  assistantText?: string;
  toolRuns?: ChatReviewToolRun[];
  /**
   * Assistant turn(s) to audit. Default clients send only the latest reply;
   * a multi-entry array is still accepted for full-thread review.
   */
  turns?: Array<{
    messageId: string;
    assistantText: string;
    toolRuns?: ChatReviewToolRun[];
  }>;
};

export type ChatSkillInput = {
  id?: string;
  title?: string;
  content?: string;
};

export type ChatMemoryInput = {
  id?: string;
  kind?: string;
  content?: string;
};

export type ChatRequestBody = {
  /** Raw body messages — must still pass validateChatMessages before use. */
  messages: unknown;
  model: string;
  temperature: number;
  systemPrompt: string;
  referenceText: string;
  skills: ChatSkillInput[];
  memories: ChatMemoryInput[];
  conversationId: string;
  enableSearch: boolean;
  integrations: string[];
  autoReview: boolean;
  requestReview: boolean;
  reviewContext: ChatReviewContext | null;
  /**
   * Optional map of attached-doc extracts (fileId → text) so file_read still
   * works after history collapse strips full bodies from older turns.
   */
  fileExtracts: Record<string, { name?: string; text: string }>;
};

const DEFAULT_MODEL = 'deepseek-v4-flash-200k';
const DEFAULT_TEMPERATURE = 0.7;

export function normalizeIntegrationIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x || '').trim().toLowerCase())
    .filter(Boolean);
}

export function parseChatRequestBody(raw: unknown): ChatRequestBody {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const skills = Array.isArray(body.skills) ? (body.skills as ChatSkillInput[]) : [];
  const memories = Array.isArray(body.memories)
    ? (body.memories as ChatMemoryInput[])
    : [];
  const fileExtracts: Record<string, { name?: string; text: string }> = {};
  const rawExtracts = body.fileExtracts;
  if (rawExtracts && typeof rawExtracts === 'object' && !Array.isArray(rawExtracts)) {
    for (const [key, val] of Object.entries(rawExtracts as Record<string, unknown>)) {
      const id = String(key || '').trim();
      if (!id) continue;
      if (typeof val === 'string' && val.trim()) {
        fileExtracts[id] = { text: val };
        continue;
      }
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const text = String((val as { text?: unknown }).text || '').trim();
        if (!text) continue;
        const name = String((val as { name?: unknown }).name || '').trim();
        fileExtracts[id] = name ? { name, text } : { text };
      }
    }
  }
  return {
    // Preserve missing/non-array messages so the route can return the same 400 as before.
    messages: body.messages,
    model: body.model == null || body.model === '' ? DEFAULT_MODEL : String(body.model),
    temperature:
      typeof body.temperature === 'number' && Number.isFinite(body.temperature)
        ? body.temperature
        : DEFAULT_TEMPERATURE,
    systemPrompt: body.systemPrompt == null ? '' : String(body.systemPrompt),
    referenceText: body.referenceText == null ? '' : String(body.referenceText),
    skills,
    memories,
    conversationId: body.conversationId == null ? '' : String(body.conversationId),
    enableSearch: body.enableSearch !== false,
    integrations: normalizeIntegrationIds(body.integrations),
    autoReview: body.autoReview !== false,
    requestReview: Boolean(body.requestReview),
    reviewContext:
      body.reviewContext && typeof body.reviewContext === 'object'
        ? (body.reviewContext as ChatReviewContext)
        : null,
    fileExtracts,
  };
}

export function validateChatMessages(messages: unknown): string | null {
  if (!Array.isArray(messages)) {
    return 'Invalid request: messages must be an array.';
  }
  return null;
}
