/**
 * Gateway model capability table (context / max output / vision).
 * Synced from the main site MODEL_SPECS; vision flags are maintained here
 * because /api/pricing does not expose them.
 */

export interface ModelSpec {
  context: number | null;
  maxOutput: number | null;
  vision: boolean;
}

/** Models known to accept image inputs via OpenAI-compatible chat.
 *  Pricing API has no vision bit — maintain explicitly + narrow name rules.
 *  Verified against vendor docs (not live image probes on every id). */
const VISION_IDS = new Set([
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5',
  'claude-sonnet-4-5',
  'claude-fable-5',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-opus-5',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'grok-4.5',
  'gemini-3.1-pro-preview',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'openrouter-free',
  'cursor-auto',
  'nemotron-3-nano-omni-free',
  /** MiniMax: only M3 is native multimodal (M2.5/M2.7 are text-only). */
  'minimax-m3',
  'minimax-m3-free',
  /** Mistral Large 3 / Medium 3.1 (`*-latest` aliases on the gateway). */
  'mistral-large-latest',
  'mistral-medium-latest',
  /** Moonshot Kimi vision family — https://platform.kimi.ai/docs/guide/use-kimi-vision-model */
  'kimi-k3',
  'kimi-k2.5',
  'kimi-k2.6',
  'kimi-k2.7',
  /** Zhipu GLM vision — used by image_understand MCP and direct vision chat. */
  'glm-4.6v',
  /** StepFun Step 3.7 Flash — native multimodal (image/video). */
  'step-3.7-flash',
]);

const SPECS: Record<string, Omit<ModelSpec, 'vision'> & { vision?: boolean }> = {
  'deepseek-v4-flash': { context: 1_000_000, maxOutput: 384_000 },
  'deepseek-v4-flash-200k': { context: 200_000, maxOutput: 128_000 },
  'deepseek-v4-pro': { context: 1_000_000, maxOutput: 384_000 },
  'glm-4.6v': { context: 128_000, maxOutput: 16_384 },
  'glm-4.7': { context: 204_800, maxOutput: 131_072 },
  'glm-5': { context: 204_800, maxOutput: 131_072 },
  'glm-5.1': { context: 200_000, maxOutput: 131_072 },
  'glm-5.2-free': { context: 1_000_000, maxOutput: 131_072 },
  'glm-5.2': { context: 1_000_000, maxOutput: 131_072 },
  'grok-4.5': { context: 500_000, maxOutput: 500_000 },
  'kimi-k3': { context: 1_000_000, maxOutput: 131_072 },
  'kimi-k2.6': { context: 262_144, maxOutput: 262_144 },
  'kimi-k2.7': { context: 262_144, maxOutput: 262_144 },
  'kimi-k2.5': { context: 262_144, maxOutput: 262_144 },
  'claude-sonnet-4-6': { context: 1_000_000, maxOutput: 128_000 },
  'claude-opus-4-6': { context: 1_000_000, maxOutput: 128_000 },
  'claude-haiku-4-5': { context: 200_000, maxOutput: 64_000 },
  'claude-sonnet-4-5': { context: 200_000, maxOutput: 64_000 },
  'claude-fable-5': { context: 1_000_000, maxOutput: 128_000 },
  'claude-sonnet-5': { context: 1_000_000, maxOutput: 128_000 },
  'claude-opus-4-8': { context: 1_000_000, maxOutput: 128_000 },
  'claude-opus-5': { context: 1_000_000, maxOutput: 128_000 },
  'gpt-5.6-sol': { context: 1_000_000, maxOutput: 128_000 },
  'gpt-5.6-terra': { context: 1_000_000, maxOutput: 128_000 },
  'gpt-5.6-luna': { context: 1_000_000, maxOutput: 128_000 },
  'gpt-5.5': { context: 1_000_000, maxOutput: 128_000 },
  'cursor-auto': { context: 1_000_000, maxOutput: 128_000 },
  'gemini-3.1-pro-preview': { context: 1_000_000, maxOutput: 128_000 },
  'gemini-3.6-flash': { context: 1_000_000, maxOutput: 65_536 },
  'gemini-3.5-flash': { context: 1_000_000, maxOutput: 128_000 },
  'gemini-3.1-flash-lite': { context: 1_000_000, maxOutput: 128_000 },
  'mistral-large-latest': { context: 262_144, maxOutput: 262_144 },
  'mistral-medium-latest': { context: 262_144, maxOutput: 262_144 },
  'minimax-m2.5': { context: 204_800, maxOutput: 131_072 },
  'minimax-m2.7': { context: 204_800, maxOutput: 131_072 },
  'minimax-m3': { context: 1_000_000, maxOutput: 128_000 },
  'minimax-m3-free': { context: 1_000_000, maxOutput: 128_000 },
  'step-3.7-flash': { context: 256_000, maxOutput: 16_384 },
  'mimo-v2.5-free': { context: 200_000, maxOutput: 32_000 },
  'nemotron-3-ultra-free': { context: 1_000_000, maxOutput: 128_000 },
  'nemotron-3-super-free': { context: 262_144, maxOutput: 128_000 },
  'nemotron-3-nano-free': { context: 256_000, maxOutput: 128_000 },
  'nemotron-3-nano-omni-free': { context: 256_000, maxOutput: 128_000 },
  'gemma-4-31b-free': { context: 262_144, maxOutput: 128_000 },
  'gpt-oss-20b-free': { context: 131_072, maxOutput: 128_000 },
  'laguna-xs-free': { context: 262_144, maxOutput: 128_000 },
  'laguna-s-2.1-free': { context: 262_144, maxOutput: 128_000 },
  'ling-3.0-flash-free': { context: 262_144, maxOutput: 128_000 },
  'openrouter-free': { context: 200_000, maxOutput: 128_000 },
  'north-mini-code-free': { context: 256_000, maxOutput: 64_000 },
  'hy3-free': { context: 200_000, maxOutput: 32_000 },
};

function looksVisionByName(id: string): boolean {
  const normalized = String(id || '').toLowerCase();
  if (/^minimax-m3(-free)?$/.test(normalized)) return true;
  if (/^mistral-(large|medium)-latest$/.test(normalized)) return true;
  if (/^kimi-k(3|2\.(5|6|7))$/.test(normalized)) return true;
  if (/^glm-4\.6v/.test(normalized)) return true;
  if (/^step-3\.7/.test(normalized)) return true;
  return /claude|gemini|gpt-4o|gpt-5|vision|omni|cursor-auto|openrouter/i.test(normalized);
}

/**
 * Image-generation-only models (Images API). They cannot chat and must not
 * appear in the conversation model picker — use `/image` instead.
 */
export function isImageGenerationModel(modelId: string): boolean {
  const id = String(modelId || '').toLowerCase();
  if (!id) return false;
  return (
    id.includes('gpt-image') ||
    id.startsWith('dall-e') ||
    id.includes('dall-e-') ||
    /^imagen[-.]/.test(id)
  );
}

/**
 * Embedding / vector models — not chat completions; hide from the model picker.
 */
export function isEmbeddingModel(modelId: string): boolean {
  const id = String(modelId || '').toLowerCase();
  if (!id) return false;
  return (
    /(^|[-_.\/])embed(ding)?(s)?([-_.\/]|$)/i.test(id) ||
    id.includes('text-embedding') ||
    id.includes('embedding-')
  );
}

/** Models that belong in the conversation picker (chat / vision). */
export function isChatPickerModel(modelId: string): boolean {
  return !isImageGenerationModel(modelId) && !isEmbeddingModel(modelId);
}

export function getModelSpec(modelId: string): ModelSpec {
  const id = String(modelId || '');
  const base = SPECS[id];
  const vision = VISION_IDS.has(id) || looksVisionByName(id);
  return {
    context: base?.context ?? null,
    maxOutput: base?.maxOutput ?? null,
    vision,
  };
}

export const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful AI assistant. Answer the user\'s questions clearly and concisely. If you\'re unsure about something, say so rather than making up information.';

/**
 * Injected server-side for Cursor / agent-style models when used in this web chat.
 * Placed FIRST in the system message so it outranks the default persona and
 * the model's built-in "I have IDE tools" prior.
 */
export const CURSOR_WEB_CHAT_PROMPT = [
  '【硬性环境约束 — 必须遵守】',
  '你当前运行在网页聊天（Christmas Chat）中，不是 Cursor IDE，也不是本机 Agent。',
  '你没有：文件系统、工作区、终端、Shell、Grep、Read、Write，或任意本地可执行工具。',
  '公开网页资料请用 web_search；需要某篇页面全文时用 web_read(url)。若本轮还启用了 Notion / GitHub / Google Workspace 等集成工具，必须以 API 下发的 tools 列表为准，不要声称“只有 web_search”。',
  '禁止口头假装正在搜索/扫描工作区/读取文件；禁止输出 tool_call XML / function_call 伪标记（应走 API 的 tool_calls）；禁止编造未返回的工具结果。',
  '得到工具结果后基于结果作答并附上来源链接；若工具失败，如实说明。',
].join('');

/** Explicit inventory so models list Notion/GitHub/Google MCP uniformly when asked. */
export function activeIntegrationsPrompt(opts: {
  searchEnabled: boolean;
  integrations: string[];
  googleRequestedButUnauthorized?: boolean;
}): string {
  const lines: string[] = [
    'Active capabilities for THIS chat (list these accurately if the user asks what tools/MCP/integrations you have):',
  ];
  if (opts.searchEnabled) {
    lines.push('- web_search: live public web lookup');
    lines.push('- web_read: fetch full text of a specific public URL (after search or when given a link)');
  }
  const set = new Set(
    (opts.integrations || []).map((id) => String(id || '').trim().toLowerCase()),
  );
  if (set.has('notion')) {
    lines.push('- Notion MCP: search/read/edit the user Notion workspace');
  }
  if (set.has('github')) {
    lines.push('- GitHub MCP: repos, issues, PRs, Actions for the connected GitHub account');
  }
  if (set.has('gmail')) {
    lines.push(
      '- Gmail MCP: profile; search/read mail & threads (incl. batch get); attachments; labels CRUD; drafts (incl. send draft); send/reply/forward; mark read/unread / archive / trash (incl. batch)',
    );
  }
  if (set.has('calendar')) {
    lines.push(
      '- Calendar MCP: list/create calendars; events CRUD/move; recurring instances; free/busy; share via ACL',
    );
  }
  if (set.has('drive')) {
    lines.push(
      '- Drive MCP: search/list folder children; get/read/export/upload; create file/folder/shortcut; shared drives; copy; rename/move; trash/delete; share/permissions; comments',
    );
  }
  if (set.has('zhipu-vision')) {
    lines.push(
      '- Image Understand MCP (image_understand): when the chat model is text-only, GLM-4.6V transcribes the image into plain text (aligned with the user ask) before you answer (billed to the user). Treat that transcription as what you saw; do not narrate the injection. Vision chat models skip this; do not call image_understand unless you need another pass on a URL.',
    );
  }
  // Legacy combined toggle (should already be expanded server-side).
  if (set.has('google') && !set.has('gmail') && !set.has('calendar') && !set.has('drive')) {
    lines.push('- Gmail MCP / Calendar MCP / Drive MCP (Google Workspace)');
  }
  if (opts.googleRequestedButUnauthorized) {
    lines.push(
      '- A Google surface (Gmail/Calendar/Drive) was toggled on, but no usable OAuth access token is available this request. Tell the user to reconnect Google in MCP settings, then retry.',
    );
  }
  if (lines.length === 1) {
    lines.push('- No third-party integrations are authorized for this request.');
  }
  return lines.join('\n');
}

/** Pin each browser chat thread so agent-style models don't bleed tasks across sessions. */
export function conversationIsolationPrompt(conversationId: string): string {
  const id = String(conversationId || '').trim() || 'unknown';
  return [
    `This web chat conversation id is "${id}".`,
    'It is completely independent of every other conversation on this account.',
    'Do not continue tasks, tool plans, workspace scans, refactors, or topics from any other chat.',
    'Only use the messages included in this request as context.',
  ].join(' ');
}

export function isCursorStyleModel(modelId: string): boolean {
  const id = String(modelId || '').toLowerCase();
  return id.startsWith('cursor') || id.includes('cursor-auto');
}

/** Rough token estimate used for UI + compact decisions. */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  // Mixed CJK / Latin heuristic: ~2 chars/token for dense CJK, ~4 for Latin.
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).join('').length;
  const rest = Math.max(0, text.length - cjk);
  return Math.ceil(cjk / 2 + rest / 4);
}

/** Compact display for model menus: 1000000 → "1M", 200000 → "200k". */
export function formatContextWindow(tokens: number | null | undefined): string {
  if (tokens == null || !Number.isFinite(tokens) || tokens <= 0) return '?';
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    const k = tokens / 1_000;
    return `${Number.isInteger(k) ? k : k.toFixed(0)}k`;
  }
  return String(tokens);
}
