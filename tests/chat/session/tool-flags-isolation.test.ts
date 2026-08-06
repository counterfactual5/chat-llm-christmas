import { describe, expect, it } from 'vitest';
import {
  applySessionToolFlagSequence,
  patchSessionAutoReview,
  patchSessionMcpIds,
} from '@/lib/chat/session/tool-flags';
import {
  stripMcpIdFromSessions,
  stripGoogleMcpFromSessions,
} from '@/lib/chat/integrations/client';
import { sessionsWorthPersisting } from '@/lib/chat/session/store';
import type { ChatSession } from '@/lib/chat/types';

function session(
  id: string,
  opts: {
    mcpIds?: string[];
    autoReview?: boolean;
    messages?: ChatSession['messages'];
  } = {},
): ChatSession {
  return {
    id,
    title: id,
    updatedAt: 1,
    messages: opts.messages ?? [
      { id: `${id}-m`, role: 'user', content: 'hi', timestamp: 1 },
    ],
    mcpIds: opts.mcpIds,
    autoReview: opts.autoReview,
  };
}

describe('per-session tool / MCP flag isolation', () => {
  it('set tools on A, change B, switch back → A unchanged', () => {
    const initial = [
      session('A', { mcpIds: [] }),
      session('B', { mcpIds: [] }),
    ];

    const afterA = patchSessionMcpIds(initial, 'A', (prev) =>
      prev.includes('paper_search') ? prev : [...prev, 'paper_search'],
    );
    expect(afterA.find((s) => s.id === 'A')?.mcpIds).toEqual(['paper_search']);
    expect(afterA.find((s) => s.id === 'B')?.mcpIds).toEqual([]);

    const afterB = applySessionToolFlagSequence(afterA, [
      {
        type: 'mcp',
        sessionId: 'B',
        updater: (prev) =>
          prev.includes('book_search') ? prev : [...prev, 'book_search'],
      },
      {
        type: 'mcp',
        sessionId: 'B',
        updater: (prev) =>
          prev.includes('notion') ? prev : [...prev, 'notion'],
      },
      { type: 'autoReview', sessionId: 'B', value: false },
    ]);

    expect(afterB.find((s) => s.id === 'A')?.mcpIds).toEqual(['paper_search']);
    expect(afterB.find((s) => s.id === 'A')?.autoReview).toBeUndefined();
    expect(afterB.find((s) => s.id === 'B')?.mcpIds).toEqual([
      'book_search',
      'notion',
    ]);
    expect(afterB.find((s) => s.id === 'B')?.autoReview).toBe(false);

    // "Switch back to A" and toggle again — B must stay intact.
    const backOnA = patchSessionMcpIds(afterB, 'A', (prev) =>
      prev.includes('generate_image') ? prev : [...prev, 'generate_image'],
    );
    expect(backOnA.find((s) => s.id === 'A')?.mcpIds).toEqual([
      'paper_search',
      'generate_image',
    ]);
    expect(backOnA.find((s) => s.id === 'B')?.mcpIds).toEqual([
      'book_search',
      'notion',
    ]);
    expect(backOnA.find((s) => s.id === 'B')?.autoReview).toBe(false);
  });

  it('does not write when sessionId is empty (avoids hydrating into wrong row)', () => {
    const initial = [session('A', { mcpIds: ['paper_search'] })];
    const next = patchSessionMcpIds(initial, '', () => ['book_search']);
    expect(next).toBe(initial);
  });

  it('OAuth scrub strips provider from every chat without copying other flags', () => {
    const initial = [
      session('A', { mcpIds: ['paper_search', 'notion'] }),
      session('B', { mcpIds: ['book_search', 'github', 'gmail'] }),
    ];
    const afterNotion = stripMcpIdFromSessions(initial, 'notion');
    expect(afterNotion.find((s) => s.id === 'A')?.mcpIds).toEqual(['paper_search']);
    expect(afterNotion.find((s) => s.id === 'B')?.mcpIds).toEqual([
      'book_search',
      'github',
      'gmail',
    ]);

    const afterGoogle = stripGoogleMcpFromSessions(afterNotion);
    expect(afterGoogle.find((s) => s.id === 'A')?.mcpIds).toEqual(['paper_search']);
    expect(afterGoogle.find((s) => s.id === 'B')?.mcpIds).toEqual([
      'book_search',
      'github',
    ]);
  });

  it('persists mcp-only drafts so toggles survive reload without messages', () => {
    const kept = sessionsWorthPersisting([
      session('empty', { messages: [] }),
      session('mcp-draft', { messages: [], mcpIds: ['zhipu-vision', 'paper_search'] }),
      session('review-only', {
        messages: [],
        autoReview: false,
      }),
    ]);
    expect(kept.map((s) => s.id)).toEqual(['mcp-draft']);
  });

  it('patchSessionAutoReview only touches the target session', () => {
    const initial = [
      session('A', { autoReview: true }),
      session('B', { autoReview: true }),
    ];
    const next = patchSessionAutoReview(initial, 'A', false);
    expect(next.find((s) => s.id === 'A')?.autoReview).toBe(false);
    expect(next.find((s) => s.id === 'B')?.autoReview).toBe(true);
  });
});
