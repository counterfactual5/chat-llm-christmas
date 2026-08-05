import { describe, expect, it } from 'vitest';
import { withUpsertedAssistantToolRun } from '@/lib/chat/session/mutations/tool-runs';
import type { ChatSession, Message } from '@/lib/chat/types';

function sessionWithAssistant(toolRuns: Message['toolRuns'] = []): ChatSession {
  return {
    id: 's1',
    title: 't',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        timestamp: 1,
        incomplete: true,
        toolRuns,
        activity: [],
      },
    ],
  };
}

function runsOf(sessions: ChatSession[]) {
  return sessions[0]!.messages[0]!.toolRuns || [];
}

describe('withUpsertedAssistantToolRun parallel same-tool queries', () => {
  it('keeps concurrent paper_search starts with different queries', () => {
    let sessions = [sessionWithAssistant()];
    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'paper_search',
      status: 'start',
      query: 'blockchain consensus',
    }).sessions;
    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'paper_search',
      status: 'start',
      query: 'Bitcoin 2024',
    }).sessions;
    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'paper_search',
      status: 'start',
      query: 'Ethereum smart contracts',
    }).sessions;

    const runs = runsOf(sessions);
    expect(runs).toHaveLength(3);
    expect(runs.every((r) => r.status === 'start')).toBe(true);
    expect(runs.map((r) => r.query)).toEqual([
      'blockchain consensus',
      'Bitcoin 2024',
      'Ethereum smart contracts',
    ]);
    expect(runs.some((r) => r.error === 'Superseded by a later call')).toBe(false);
  });

  it('matches done events to the start with the same query', () => {
    let sessions = [sessionWithAssistant()];
    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'paper_search',
      status: 'start',
      query: 'A',
    }).sessions;
    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'paper_search',
      status: 'start',
      query: 'B',
    }).sessions;
    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'paper_search',
      status: 'done',
      query: 'B',
      results: [{ title: 'b', url: 'https://b', snippet: '' }],
    }).sessions;

    const runs = runsOf(sessions);
    expect(runs).toHaveLength(2);
    const a = runs.find((r) => r.query === 'A');
    const b = runs.find((r) => r.query === 'B');
    expect(a?.status).toBe('start');
    expect(b?.status).toBe('done');
    expect(b?.results?.[0]?.title).toBe('b');
    expect(a?.error).toBeUndefined();
  });

  it('supersedes only a pending start with the same query when callId is absent', () => {
    let sessions = [sessionWithAssistant()];
    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'paper_search',
      status: 'start',
      query: 'same',
    }).sessions;
    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'paper_search',
      status: 'start',
      query: 'other',
    }).sessions;
    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'paper_search',
      status: 'start',
      query: 'same',
    }).sessions;

    const runs = runsOf(sessions);
    expect(runs).toHaveLength(3);
    const sameRuns = runs.filter((r) => r.query === 'same');
    expect(sameRuns).toHaveLength(2);
    expect(sameRuns.filter((r) => r.status === 'start')).toHaveLength(1);
    expect(sameRuns.filter((r) => r.status === 'done' && r.error)).toHaveLength(1);
    expect(runs.find((r) => r.query === 'other')?.status).toBe('start');
  });

  it('matches parallel identical queries by callId', () => {
    let sessions = [sessionWithAssistant()];
    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'paper_search',
      status: 'start',
      query: 'same',
      callId: 'call_a',
    }).sessions;
    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'paper_search',
      status: 'start',
      query: 'same',
      callId: 'call_b',
    }).sessions;
    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'paper_search',
      status: 'done',
      query: 'same',
      callId: 'call_b',
      results: [{ title: 'b', url: 'https://b', snippet: '' }],
    }).sessions;

    const runs = runsOf(sessions);
    expect(runs).toHaveLength(2);
    expect(runs.find((r) => r.callId === 'call_a')?.status).toBe('start');
    expect(runs.find((r) => r.callId === 'call_b')?.status).toBe('done');
    expect(runs.find((r) => r.callId === 'call_b')?.results?.[0]?.title).toBe('b');
  });
});

describe('withUpsertedAssistantToolRun openContextPanel', () => {
  it('opens when a search adds new browseable Material URLs', () => {
    let sessions = [sessionWithAssistant()];
    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'web_search',
      status: 'start',
      query: 'q',
    }).sessions;
    const done = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'web_search',
      status: 'done',
      query: 'q',
      results: [{ title: 'A', url: 'https://example.com/a', snippet: '' }],
    });
    expect(done.openContextPanel).toBe(true);
    expect(done.sessions[0]!.webSources?.map((s) => s.url)).toEqual([
      'https://example.com/a',
    ]);
  });

  it('does not reopen for file_read when older Material already exists', () => {
    let sessions = [sessionWithAssistant()];
    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'web_search',
      status: 'start',
      query: 'q',
    }).sessions;
    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'web_search',
      status: 'done',
      query: 'q',
      results: [{ title: 'A', url: 'https://example.com/a', snippet: '' }],
    }).sessions;

    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'file_read',
      status: 'start',
      query: 'file_x',
    }).sessions;
    const readDone = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'file_read',
      status: 'done',
      query: 'file_x',
      provider: 'file-read',
      results: [
        {
          title: 'doc.pdf',
          url: '/api/files/file_x',
          snippet: 'page text',
        },
      ],
    });
    expect(readDone.openContextPanel).toBe(false);
    expect(readDone.sessions[0]!.webSources?.map((s) => s.url)).toEqual([
      'https://example.com/a',
    ]);
  });

  it('opens again when a later search adds another URL', () => {
    let sessions = [sessionWithAssistant()];
    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'web_search',
      status: 'start',
      query: 'q1',
    }).sessions;
    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'web_search',
      status: 'done',
      query: 'q1',
      results: [{ title: 'A', url: 'https://example.com/a', snippet: '' }],
    }).sessions;

    sessions = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'web_search',
      status: 'start',
      query: 'q2',
    }).sessions;
    const second = withUpsertedAssistantToolRun(sessions, 's1', 'a1', {
      name: 'web_search',
      status: 'done',
      query: 'q2',
      results: [{ title: 'B', url: 'https://example.com/b', snippet: '' }],
    });
    expect(second.openContextPanel).toBe(true);
    expect(second.sessions[0]!.webSources?.map((s) => s.url).sort()).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });
});
