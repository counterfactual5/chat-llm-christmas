import type { ChatSession } from '@/lib/chat/types';
import { displayAssistantParts } from '@/lib/chat/message/display';
import { contentHasThinkMarkup } from '@/lib/chat/message/think-tags';
import { contentHasToolMarkup } from '@/lib/chat/message/tool-tags';

/** localStorage key recording which account owns the cached chats (anti cross-account bleed). */
export const CHATS_OWNER_KEY = 'llm_christmas_chats_owner';

/** Sessions with messages or per-chat MCP/Skills — worth keeping in local/cloud storage. */
export function sessionsWorthPersisting(sessions: ChatSession[]): ChatSession[] {
  return sessions.filter(
    (session) =>
      session.messages.length > 0 ||
      (session.mcpIds && session.mcpIds.length > 0) ||
      (session.skillIds && session.skillIds.length > 0),
  );
}

/** Normalize a session restored from localStorage or the cloud: close stale streams, fold think markup. */
export function normalizeRestoredSession(session: ChatSession): ChatSession {
  return {
    ...session,
    messages: (session.messages || []).map((m) => {
      let next = m;
      // Page refresh aborts in-flight streams. An incomplete flag without an
      // active request would leave Process spinning forever.
      if (m.role === 'assistant' && m.incomplete) {
        next = {
          ...next,
          incomplete: true,
          truncationReason: m.truncationReason || 'Reply was interrupted',
          toolRuns: (m.toolRuns || []).map((r) =>
            r.status === 'start' ? { ...r, status: 'done' as const } : r,
          ),
        };
      }
      if (
        next.role !== 'assistant' ||
        (!contentHasThinkMarkup(next.content) && !contentHasToolMarkup(next.content))
      ) {
        return next;
      }
      const parts = displayAssistantParts(next);
      return {
        ...next,
        content: parts.content,
        reasoning: parts.reasoning || undefined,
      };
    }),
  };
}

/** Merge local + cloud sessions per id, keeping the newer updatedAt (LWW). */
export function mergeSyncedSessions(local: ChatSession[], cloud: ChatSession[]): ChatSession[] {
  const byId = new Map<string, ChatSession>();
  for (const s of local) byId.set(s.id, s);
  for (const raw of cloud) {
    if (!raw?.id) continue;
    const remote = normalizeRestoredSession(raw);
    const existing = byId.get(remote.id);
    if (!existing || Number(remote.updatedAt || 0) >= Number(existing.updatedAt || 0)) {
      byId.set(remote.id, remote);
    }
  }
  return [...byId.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

const SYNC_DATAURL_LIMIT = 100 * 1024;
/** Deep-clone sessions for upload, blanking huge inline data: URLs (legacy images). */
export function sessionsForCloudSync(sessions: ChatSession[]): ChatSession[] {
  const scrub = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value.startsWith('data:') && value.length > SYNC_DATAURL_LIMIT ? '' : value;
    }
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = scrub(v);
      }
      return out;
    }
    return value;
  };
  return sessions.map((s) => scrub(s) as ChatSession);
}

