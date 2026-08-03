/**
 * Optional built-in chat tools (Paper / Book / Generate Image).
 * Default OFF — enabled per conversation via session.mcpIds.
 * Slash commands (/papers|/books|/image) stay available either way.
 */

export const OPTIONAL_BUILTIN_TOOL_IDS = [
  'paper_search',
  'book_search',
  'generate_image',
] as const;

export type OptionalBuiltinToolId = (typeof OPTIONAL_BUILTIN_TOOL_IDS)[number];

export function isOptionalBuiltinToolId(id: string): id is OptionalBuiltinToolId {
  return (OPTIONAL_BUILTIN_TOOL_IDS as readonly string[]).includes(id);
}
