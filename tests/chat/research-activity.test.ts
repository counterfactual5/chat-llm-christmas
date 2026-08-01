import { describe, expect, it } from 'vitest';
import {
  applyResearchEvent,
  createResearchAssistantMessage,
  withResearchReport,
} from '@/lib/chat/turn/research-activity';
import { buildTimelineSegments } from '@/lib/chat/message/timeline';

describe('research activity → timeline stages', () => {
  it('opens Plan / Search panels from phase events', () => {
    let m = createResearchAssistantMessage({
      id: 'a1',
      jobId: 'rs_1',
      query: 'BTC',
      mode: 'standard',
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'planning', detail: 'claimed' },
    });
    m = applyResearchEvent(m, {
      kind: 'plan',
      payload: { subQuestions: ['q1'], searchQueries: ['btc price'] },
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'searching', detail: 'searching 2 queries' },
    });
    m = applyResearchEvent(m, {
      kind: 'search',
      payload: { query: 'btc price', status: 'start' },
    });
    m = applyResearchEvent(m, {
      kind: 'search',
      payload: { query: 'btc price', status: 'ok', provider: 'zhipu', count: 3 },
    });

    const toolById = new Map((m.toolRuns || []).map((r) => [r.id, r]));
    const segs = buildTimelineSegments({
      messageId: m.id,
      activitySteps: m.activity || [],
      toolById,
      visibleContent: '',
      messageIsStreaming: true,
      awaitingFirstContent: true,
      replyWait: false,
    });
    const processSegs = segs.filter((s) => s.type === 'process');
    expect(processSegs.map((s) => (s.type === 'process' ? s.title : ''))).toEqual([
      'Plan',
      'Search',
    ]);
  });

  it('attaches report content and clears incomplete', () => {
    let m = createResearchAssistantMessage({
      id: 'a2',
      jobId: 'rs_2',
      query: 'x',
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'writing' },
    });
    m = withResearchReport(m, '## 用户问题直答\nhello');
    expect(m.incomplete).toBe(false);
    expect(m.content).toContain('用户问题直答');
    expect(m.activity?.some((s) => s.kind === 'content')).toBe(true);
  });

  it('marks failed research incomplete with truncationReason', () => {
    let m = createResearchAssistantMessage({
      id: 'a3',
      jobId: 'rs_3',
      query: 'x',
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'verifying' },
    });
    m = applyResearchEvent(m, {
      kind: 'error',
      payload: { message: 'LLM HTTP 524' },
    });
    expect(m.incomplete).toBe(true);
    expect(m.truncationReason).toContain('524');
    expect(m.research?.status).toBe('failed');
  });
});
