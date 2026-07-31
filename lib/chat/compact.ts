import type { Message } from '@/lib/chat/types';
import { toApiMessages } from '@/lib/chat/api-messages';

export type CompactConversationResult = {
  messages: Message[] | null;
  notice: string;
};

/**
 * Summarize older turns via /api/compact, keeping the newest `keep` messages.
 * Returns null messages when the request fails.
 */
export async function compactConversationHistory(opts: {
  history: Message[];
  model: string;
  vision?: boolean;
  keep?: number;
}): Promise<CompactConversationResult> {
  const keep = Math.min(opts.keep ?? 6, opts.history.length);
  if (opts.history.length <= keep) {
    return { messages: opts.history, notice: '' };
  }

  const older = opts.history.slice(0, opts.history.length - keep);
  const recent = opts.history.slice(opts.history.length - keep);

  try {
    const res = await fetch('/api/compact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        messages: toApiMessages(older, { vision: opts.vision }),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Compact failed');

    const compacted: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: `[Compacted earlier conversation]\n\n${data.summary}`,
      timestamp: Date.now(),
      compacted: true,
    };
    return {
      messages: [compacted, ...recent],
      notice: `Compacted ${older.length} older messages`,
    };
  } catch (err: any) {
    return {
      messages: null,
      notice: err?.message || 'Compact failed',
    };
  }
}
