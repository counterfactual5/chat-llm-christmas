/**
 * Model thinking / chain-of-thought request policy for the chat API.
 * Pure name-based heuristics — no network I/O.
 */

/**
 * Whether to send `enable_thinking: true` proactively.
 *
 * Keep this narrow: llm.christmas validates the parameter per model and returns
 * 400 Unsupported for variants that do not allow it (seen on deepseek-v4-flash).
 * Name tokens like r1 / reason / thinking / qwq are the safe opt-in signal.
 * Do NOT blanket whole families (deepseek-v4*, glm-5*, kimi-k2*, minimax-m3*) —
 * streamChatCompletionsRaw also retries once without the flag if rejected.
 *
 * Separately, modelNeedsThinkingForTools() may still force thinking for GLM
 * when tools are present (empty-stream workaround).
 */
export function wantsThinking(model: string): boolean {
  return /(^|[-_])(r1|reason|thinking|qwq)([-_]|$)/i.test(String(model || ''));
}

/** GLM-4.7 tool-calling expects thinking; without it the stream often ends empty. */
export function modelNeedsThinkingForTools(model: string): boolean {
  return /glm-4\.7|glm-4\.6(?!v)|glm-5/i.test(String(model || ''));
}

/**
 * These models often put the full answer in reasoning_* even when the user-
 * visible reply should be normal chat text. The server still sends reasoning
 * and content separately; the **client** promotes orphan reasoning → content
 * at settle time if the stream produced no visible content.
 */
export function modelDumpsAnswerInReasoning(model: string): boolean {
  return /glm-4\.7|glm-4\.6(?!v)/i.test(String(model || ''));
}
