import { describe, expect, it } from 'vitest';
import {
  buildSidebarDayGroups,
  sessionLastUserRequestAt,
  sessionsForSidebar,
} from '@/lib/chat/context/sidebar';
import type { ChatSession } from '@/lib/chat/types';

function session(opts: {
  id: string;
  updatedAt: number;
  userAt?: number;
  assistantAt?: number;
}): ChatSession {
  const messages: ChatSession['messages'] = [];
  if (opts.userAt != null) {
    messages.push({
      id: `${opts.id}-u`,
      role: 'user',
      content: 'hi',
      timestamp: opts.userAt,
    });
  }
  if (opts.assistantAt != null) {
    messages.push({
      id: `${opts.id}-a`,
      role: 'assistant',
      content: 'hello',
      timestamp: opts.assistantAt,
    });
  }
  return {
    id: opts.id,
    title: opts.id,
    updatedAt: opts.updatedAt,
    messages,
  };
}

describe('sidebar session ordering', () => {
  it('sorts by last user send time, not streaming updatedAt', () => {
    const a = session({ id: 'a', userAt: 100, assistantAt: 150, updatedAt: 999 });
    const b = session({ id: 'b', userAt: 200, assistantAt: 210, updatedAt: 220 });
    const ordered = sessionsForSidebar([a, b]);
    expect(ordered.map((s) => s.id)).toEqual(['b', 'a']);
    expect(sessionLastUserRequestAt(a)).toBe(100);
    expect(sessionLastUserRequestAt(b)).toBe(200);
  });

  it('keeps concurrent streams stable when only updatedAt advances', () => {
    const early = session({ id: 'early', userAt: 100, assistantAt: 110, updatedAt: 110 });
    const late = session({ id: 'late', userAt: 200, assistantAt: 205, updatedAt: 205 });
    const first = sessionsForSidebar([early, late]).map((s) => s.id);
    // Simulate early chat still streaming — updatedAt keeps jumping ahead.
    early.updatedAt = 10_000;
    early.messages[1]!.timestamp = 10_000;
    const second = sessionsForSidebar([early, late]).map((s) => s.id);
    expect(first).toEqual(['late', 'early']);
    expect(second).toEqual(['late', 'early']);
  });

  it('groups days by last user request day', () => {
    const olderUser = session({
      id: 'old',
      userAt: Date.parse('2026-07-30T12:00:00'),
      assistantAt: Date.parse('2026-08-02T18:00:00'),
      updatedAt: Date.parse('2026-08-02T18:00:00'),
    });
    const groups = buildSidebarDayGroups([olderUser], '2026-08-02');
    expect(groups.map((g) => g.key)).toEqual(['2026-07-30']);
  });
});
