import { describe, expect, it } from 'vitest';
import {
  enableGoogleSurfacesOnNewestSession,
  stripGoogleMcpFromSessions,
  stripMcpIdFromSessions,
} from '@/lib/chat/integrations-client';
import { sessionsWorthPersisting } from '@/lib/chat/sessions';
import type { ChatSession } from '@/lib/chat/types';

function session(
  id: string,
  mcpIds: string[] = [],
  messages: ChatSession['messages'] = [],
): ChatSession {
  return { id, title: id, updatedAt: 1, messages, mcpIds };
}

describe('integrations-client session transforms', () => {
  it('strips a single mcp id from every session', () => {
    const next = stripMcpIdFromSessions(
      [session('a', ['notion', 'github']), session('b', ['notion'])],
      'notion',
    );
    expect(next[0].mcpIds).toEqual(['github']);
    expect(next[1].mcpIds).toEqual([]);
  });

  it('strips all Google surface ids', () => {
    const next = stripGoogleMcpFromSessions([
      session('a', ['gmail', 'calendar', 'drive', 'notion']),
    ]);
    expect(next[0].mcpIds).toEqual(['notion']);
  });

  it('enables Google surfaces on the newest session only once', () => {
    const first = enableGoogleSurfacesOnNewestSession([
      session('new', []),
      session('old', ['notion']),
    ]);
    expect(first[0].mcpIds).toEqual(['gmail', 'calendar', 'drive']);
    expect(first[1].mcpIds).toEqual(['notion']);

    const again = enableGoogleSurfacesOnNewestSession(first);
    expect(again[0].mcpIds).toEqual(['gmail', 'calendar', 'drive']);
  });
});

describe('sessionsWorthPersisting', () => {
  it('keeps drafts that only have mcp toggles', () => {
    const kept = sessionsWorthPersisting([
      session('empty'),
      session('mcp-only', ['github']),
      session('msg', [], [{ id: 'm', role: 'user', content: 'hi', timestamp: 1 }]),
    ]);
    expect(kept.map((s) => s.id)).toEqual(['mcp-only', 'msg']);
  });
});
