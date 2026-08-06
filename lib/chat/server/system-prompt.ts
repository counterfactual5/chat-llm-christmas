/**
 * Server entry for chat system-prompt assembly.
 * Implementation lives in `@/lib/chat/prompt/system-parts` (client-safe).
 */

export {
  buildChatSystemParts,
  joinChatSystemParts,
  type BuildChatSystemPartsOpts,
  type ChatSystemSkillInput,
} from '@/lib/chat/prompt/system-parts';

/** @deprecated Use ChatSystemSkillInput — kept for existing server imports. */
export type { ChatSystemSkillInput as ChatSkillInput } from '@/lib/chat/prompt/system-parts';
