/**
 * Optional built-in chat tools (Generate Image).
 * Default OFF — enabled per conversation via session.mcpIds.
 * Slash `/image` stays available either way.
 * Paper/Book are command-only (`/papers` `/books`) — not mid-reply tools.
 */

export const OPTIONAL_BUILTIN_TOOL_IDS = ['generate_image'] as const;

export type OptionalBuiltinToolId = (typeof OPTIONAL_BUILTIN_TOOL_IDS)[number];

export function isOptionalBuiltinToolId(id: string): id is OptionalBuiltinToolId {
  return (OPTIONAL_BUILTIN_TOOL_IDS as readonly string[]).includes(id);
}
