import { describe, expect, it } from 'vitest';
import {
  serializeReviewToolRuns,
  settleEmptyBodyAction,
  withAppendedAssistantContent,
  withAppendedAssistantReasoning,
  withAppendedAssistantToolView,
  withEmptyReplyFallback,
  withMarkedAssistantIncomplete,
  withPromotedOrphanReasoning,
} from '@/lib/chat/session/mutations';
import type { ChatSession, Message } from '@/lib/chat/types';

function msg(partial: Partial<Message> & Pick<Message, 'id' | 'role' | 'content'>): Message {
  return {
    id: partial.id,
    role: partial.role,
    content: partial.content,
    timestamp: partial.timestamp ?? 1,
    incomplete: partial.incomplete,
    reasoning: partial.reasoning,
    truncationReason: partial.truncationReason,
  };
}

function session(messages: Message[]): ChatSession {
  return {
    id: 's1',
    title: 't',
    messages,
    updatedAt: 1,
  };
}

describe('session/mutations', () => {
  it('marks incomplete and clears truncation when complete', () => {
    const sessions = [
      session([
        msg({
          id: 'a',
          role: 'assistant',
          content: 'hi',
          incomplete: true,
          truncationReason: 'Stopped by you',
        }),
      ]),
    ];
    const marked = withMarkedAssistantIncomplete(sessions, 's1', 'a', true, {
      truncationReason: 'x',
    });
    expect(marked[0].messages[0].truncationReason).toBe('x');
    const done = withMarkedAssistantIncomplete(marked, 's1', 'a', false);
    expect(done[0].messages[0].incomplete).toBe(false);
    expect(done[0].messages[0].truncationReason).toBeUndefined();
  });

  it('promotes orphan reasoning and applies empty fallback', () => {
    const sessions = [
      session([
        msg({
          id: 'a',
          role: 'assistant',
          content: '',
          reasoning: 'thought',
          incomplete: true,
        }),
      ]),
    ];
    const promoted = withPromotedOrphanReasoning(sessions, 's1', 'a', 'thought');
    expect(promoted[0].messages[0].content).toBe('thought');
    expect(promoted[0].messages[0].reasoning).toBeUndefined();

    const fallback = withEmptyReplyFallback(sessions, 's1', 'a', '(empty)');
    expect(fallback[0].messages[0].content).toBe('(empty)');
    expect(fallback[0].messages[0].incomplete).toBe(false);
  });

  it('keeps review-report CoT in one Thought step when no tool runs in between', () => {
    let sessions = [
      session([
        msg({ id: 'a', role: 'assistant', content: '', incomplete: true }),
      ]),
    ];
    const r = (chunk: string) => {
      sessions = withAppendedAssistantReasoning(sessions, 's1', 'a', chunk);
    };
    const c = (chunk: string) => {
      sessions = withAppendedAssistantContent(sessions, 's1', 'a', chunk);
    };

    r('Have to analyze. ');
    c('## 结论\n');
    c('第一段。 ');
    r('But compare it... ');
    c('\n第二段。 ');
    r('Check some more. ');
    c('\n第三段。');

    const m = sessions[0].messages[0];
    expect(m.activity?.filter((s) => s.kind === 'reasoning')).toHaveLength(1);
    expect(m.reasoning).toBe(
      'Have to analyze. But compare it... Check some more. ',
    );
    expect(m.content).toBe('## 结论\n第一段。 \n第二段。 \n第三段。');
    // Draft thinking is collected (not scattered between body paragraphs); the
    // single Thought step is moved after the content it accompanied.
    expect(m.activity?.map((s) => s.kind)).toEqual([
      'content',
      'content',
      'reasoning',
      'content',
    ]);
  });

  it('still forks a new Thought step after a real tool run', () => {
    let sessions = [
      session([
        msg({ id: 'a', role: 'assistant', content: '', incomplete: true }),
      ]),
    ];
    sessions = withAppendedAssistantReasoning(sessions, 's1', 'a', 'think1');
    sessions = sessions.map((s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.id === 'a'
          ? {
              ...m,
              activity: [
                ...(m.activity || []),
                { id: 't1', kind: 'tool' as const, toolRunId: 'r1' },
              ],
              toolRuns: [
                {
                  id: 'r1',
                  name: 'web_search',
                  status: 'done' as const,
                  provider: 'test',
                },
              ],
            }
          : m,
      ),
    }));
    sessions = withAppendedAssistantContent(sessions, 's1', 'a', 'answer');
    sessions = withAppendedAssistantReasoning(sessions, 's1', 'a', 'think2');

    const m = sessions[0].messages[0];
    expect(m.activity?.filter((s) => s.kind === 'reasoning')).toHaveLength(2);
    expect(m.reasoning).toBe('think1think2');
  });

  it('does not promote reasoning that was rewound by orphan </think>', () => {
    expect(
      settleEmptyBodyAction({
        suppressedOrphanPromote: true,
        reasoning: 'draft before close tag',
      }),
    ).toBe('thought_only');
    expect(
      settleEmptyBodyAction({
        suppressedOrphanPromote: false,
        reasoning: 'gateway put answer in reasoning',
      }),
    ).toBe('promote');
    expect(
      settleEmptyBodyAction({
        suppressedOrphanPromote: false,
        reasoning: '',
      }),
    ).toBe('empty_error');
  });

  it('serializes review tool runs with body cap', () => {
    const rows = serializeReviewToolRuns([
      {
        id: '1',
        name: 'web_search',
        status: 'done',
        query: 'q',
        results: [
          {
            title: 't',
            url: 'https://ex.com',
            snippet: 's',
            body: 'x'.repeat(20_000),
          },
        ],
      },
    ]);
    expect(rows[0].results?.[0].body?.length).toBe(16_000);
  });

  it('appends a specialized tool view and activity step', () => {
    const sessions = [
      session([
        msg({
          id: 'a',
          role: 'assistant',
          content: 'hi',
        }),
      ]),
    ];
    const next = withAppendedAssistantToolView(sessions, 's1', 'a', {
      id: 'view_1',
      viewType: 'docx.extract',
      title: 'report.docx',
      sourceFileId: 'file_abc',
      sourceFileName: 'report.docx',
      createdAt: 42,
      data: { sections: [{ markdown: 'Hello' }] },
    });
    const m = next[0].messages[0];
    expect(m.views).toHaveLength(1);
    expect(m.views?.[0]).toMatchObject({
      id: 'view_1',
      viewType: 'docx.extract',
      title: 'report.docx',
      sourceFileId: 'file_abc',
    });
    expect(m.activity?.some((s) => s.kind === 'view' && s.viewId === 'view_1')).toBe(
      true,
    );

    const dup = withAppendedAssistantToolView(next, 's1', 'a', {
      id: 'view_1',
      viewType: 'docx.extract',
      title: 'report.docx',
      data: { sections: [] },
    });
    expect(dup[0].messages[0].views).toHaveLength(1);
  });
});
