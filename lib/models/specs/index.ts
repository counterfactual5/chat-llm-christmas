/**
 * Model specs public API.
 *
 *  catalog.ts  context / maxOutput / vision table
 *  filters.ts  picker / embedding / image / cursor classifiers
 *  prompts.ts  system + integrations prompts
 *  tokens.ts   estimateTokensFromText / formatContextWindow
 */

export type { ModelSpec } from '@/lib/models/specs/catalog';
export { getModelSpec } from '@/lib/models/specs/catalog';
export {
  isImageGenerationModel,
  isEmbeddingModel,
  isChatPickerModel,
  isCursorStyleModel,
} from '@/lib/models/specs/filters';
export {
  DEFAULT_SYSTEM_PROMPT,
  CURSOR_WEB_CHAT_PROMPT,
  activeIntegrationsPrompt,
  conversationIsolationPrompt,
} from '@/lib/models/specs/prompts';
export { estimateTokensFromText, formatContextWindow } from '@/lib/models/specs/tokens';
