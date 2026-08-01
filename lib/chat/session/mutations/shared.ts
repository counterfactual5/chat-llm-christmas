/**
 * Shared session touch helper for mutation modules.
 */

import type { ChatSession } from '@/lib/chat/types';

export function touchSession(session: ChatSession, patch: Partial<ChatSession>): ChatSession {
  return { ...session, ...patch, updatedAt: Date.now() };
}
