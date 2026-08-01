/**
 * Model capability catalog (context / max output / vision).
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
  /** Google Gemma 4 — native multimodal (text + image; 31B dense on this gateway). */
  'gemma-4-31b-free',
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
  // Gemma 4 family is multimodal (image); Gemma 3 4B+ also supports vision.
  if (/^gemma-4/.test(normalized)) return true;
  if (/^gemma-3-(4|12|27)/.test(normalized)) return true;
  return /claude|gemini|gpt-4o|gpt-5|vision|omni|cursor-auto|openrouter/i.test(normalized);
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
