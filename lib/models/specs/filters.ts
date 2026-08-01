/**
 * Model-id classifiers for the chat picker and agent styling.
 */

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

export function isCursorStyleModel(modelId: string): boolean {
  const id = String(modelId || '').toLowerCase();
  return id.startsWith('cursor') || id.includes('cursor-auto');
}
