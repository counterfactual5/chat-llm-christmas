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
      kind: 'phase',
      payload: { status: 'planning', detail: 'planning research outline' },
    });
    expect(m.activity?.filter((s) => s.kind === 'stage')).toHaveLength(1);
    expect(m.toolRuns?.filter((r) => r.name === 'research_plan')).toHaveLength(1);
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
    // Report body stays on message.content (timeline appends it after Process).
    expect(m.activity?.some((s) => s.kind === 'content')).toBe(false);
    expect(m.research?.status).toBe('done');
  });

  it('opens Synthesize panel from synthesizing phase', () => {
    let m = createResearchAssistantMessage({
      id: 'a4',
      jobId: 'rs_4',
      query: 'topic',
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'synthesizing', detail: 'cross-source synthesis' },
    });
    expect(m.activity?.some((s) => s.kind === 'stage' && s.title === 'Synthesize')).toBe(
      true,
    );
    expect(m.toolRuns?.some((r) => r.name === 'research_synthesize')).toBe(true);
    m = applyResearchEvent(m, {
      kind: 'synthesis',
      payload: { chars: 1200, preview: '跨源对比：来源对病因口径不一…\n\n## 数据缺口\n待核实…' },
    });
    const syn = m.toolRuns?.find((r) => r.name === 'research_synthesize');
    expect(syn?.status).toBe('done');
    expect(syn?.results?.[0]?.snippet).toContain('1200');
    expect(syn?.results?.[0]?.body).toContain('跨源对比');
  });

  it('stores Verify preview and gate summary on the tool', () => {
    let m = createResearchAssistantMessage({
      id: 'a4v',
      jobId: 'rs_4v',
      query: 'topic',
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'verifying', detail: 'fact-checking synthesis' },
    });
    m = applyResearchEvent(m, {
      kind: 'verified_quality',
      payload: { attempt: 1, ok: false, errors: ['缺 contradictions 节'] },
    });
    expect(m.reasoning || '').toContain('Verify gate');
    m = applyResearchEvent(m, {
      kind: 'verified',
      payload: {
        chars: 400,
        preview: '## 已核实\n- 点 A\n',
        ok: true,
        errors: [],
      },
    });
    const ver = m.toolRuns?.find((r) => r.name === 'research_verify');
    expect(ver?.status).toBe('done');
    expect(ver?.results?.[0]?.snippet).toContain('passed');
    expect(ver?.results?.[0]?.body).toContain('已核实');
  });

  it('research error clears partial bubble content', () => {
    let m = createResearchAssistantMessage({
      id: 'a4e',
      jobId: 'rs_4e',
      query: 'topic',
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'writing', detail: 'drafting report' },
    });
    m = applyResearchEvent(m, {
      kind: 'report_delta',
      payload: { text: '草案不应进正文' },
    });
    // Simulate legacy / stray content in the bubble.
    m = { ...m, content: '草案不应进正文' };
    m = applyResearchEvent(m, {
      kind: 'error',
      payload: { message: '质量门禁未通过: Tier 1 来源仅 1 条（standard 期望 ≥2）' },
    });
    expect(m.content).toBe('');
    expect(m.truncationReason).toContain('Tier 1');
    expect(
      m.toolRuns?.find((r) => r.name === 'research_write')?.results?.[0]?.body,
    ).toContain('草案');
  });

  it('records soft-empty search without Failed error', () => {
    let m = createResearchAssistantMessage({
      id: 'a6',
      jobId: 'rs_6',
      query: 'topic',
    });
    m = applyResearchEvent(m, {
      kind: 'search',
      payload: {
        query: 'nocturnal leg cramps causes prevention medical',
        status: 'start',
      },
    });
    m = applyResearchEvent(m, {
      kind: 'search',
      payload: {
        query: 'nocturnal leg cramps causes prevention medical',
        status: 'empty',
        provider: 'none',
        count: 0,
        error: 'zhipu: Zhipu MCP returned no results',
      },
    });
    const run = m.toolRuns?.find((r) => r.name === 'web_search');
    expect(run?.status).toBe('done');
    expect(run?.error).toBeFalsy();
    expect(run?.results?.length || 0).toBe(0);
  });

  it('keeps hard search failures as errors', () => {
    let m = createResearchAssistantMessage({
      id: 'a7',
      jobId: 'rs_7',
      query: 'topic',
    });
    m = applyResearchEvent(m, {
      kind: 'search',
      payload: { query: 'x', status: 'start' },
    });
    m = applyResearchEvent(m, {
      kind: 'search',
      payload: {
        query: 'x',
        status: 'empty',
        provider: 'none',
        count: 0,
        error: 'tavily: Tavily HTTP 502',
      },
    });
    const run = m.toolRuns?.find((r) => r.name === 'web_search');
    expect(run?.error).toContain('Tavily HTTP 502');
  });

  it('records web_read without a fake research provider label', () => {
    let m = createResearchAssistantMessage({
      id: 'a5',
      jobId: 'rs_5',
      query: 'topic',
    });
    m = applyResearchEvent(m, {
      kind: 'read',
      payload: { url: 'https://example.com/a', chars: 420 },
    });
    const read = m.toolRuns?.find((r) => r.name === 'web_read');
    expect(read?.status).toBe('done');
    expect(read?.provider).toBeFalsy();
    expect(read?.query).toBe('https://example.com/a');
  });

  it('keeps parallel reads distinct and surfaces read failures', () => {
    let m = createResearchAssistantMessage({
      id: 'a5c',
      jobId: 'rs_5c',
      query: 'topic',
    });
    m = applyResearchEvent(m, {
      kind: 'read',
      payload: { status: 'start', url: 'https://a.example/x', title: 'A' },
    });
    m = applyResearchEvent(m, {
      kind: 'read',
      payload: { status: 'start', url: 'https://b.example/y', title: 'B' },
    });
    expect(m.toolRuns?.filter((r) => r.name === 'web_read' && r.status === 'start')).toHaveLength(
      2,
    );
    m = applyResearchEvent(m, {
      kind: 'read',
      payload: {
        status: 'ok',
        url: 'https://a.example/x',
        title: 'A',
        chars: 100,
      },
    });
    m = applyResearchEvent(m, {
      kind: 'read',
      payload: {
        status: 'error',
        url: 'https://b.example/y',
        title: 'B',
        error: 'All readers failed | zhipu: timeout',
      },
    });
    const reads = m.toolRuns?.filter((r) => r.name === 'web_read') || [];
    expect(reads).toHaveLength(2);
    expect(reads.find((r) => r.query === 'https://a.example/x')?.error).toBeFalsy();
    expect(reads.find((r) => r.query === 'https://b.example/y')?.error).toContain('无法抓取正文');
  });

  it('sources summary includes read success rate', () => {
    let m = createResearchAssistantMessage({
      id: 'a5d',
      jobId: 'rs_5d',
      query: 'topic',
    });
    m = applyResearchEvent(m, {
      kind: 'sources',
      payload: { count: 18, tier1Count: 0, reads: 1, readAttempts: 6, items: [] },
    });
    expect(m.reasoning || '').toContain('read 1/6 pages');
  });

  it('labels academic enrichments as paper_read', () => {
    let m = createResearchAssistantMessage({
      id: 'a5b',
      jobId: 'rs_5b',
      query: 'topic',
    });
    m = applyResearchEvent(m, {
      kind: 'read',
      payload: {
        url: 'https://openalex.org/W123',
        chars: 800,
        title: 'Dietary patterns and disease risk',
        sourceKind: 'paper',
        sourceProvider: 'openalex',
      },
    });
    const read = m.toolRuns?.find((r) => r.name === 'paper_read');
    expect(read?.status).toBe('done');
    expect(read?.provider).toBe('openalex');
    expect(read?.results?.[0]?.title).toContain('Dietary');
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

  it('report_delta streams into Write draft, not the answer bubble', () => {
    let m = createResearchAssistantMessage({
      id: 'a8',
      jobId: 'rs_8',
      query: 'x',
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'writing', detail: 'drafting report' },
    });
    m = applyResearchEvent(m, {
      kind: 'report_delta',
      payload: { text: '## 用户问题直答\n草案' },
    });
    expect(m.content || '').toBe('');
    const write = m.toolRuns?.find((r) => r.name === 'research_write');
    expect(write?.status).toBe('start');
    expect(write?.results?.[0]?.body).toContain('草案');

    m = applyResearchEvent(m, {
      kind: 'report_reset',
      payload: {},
    });
    expect(m.content || '').toBe('');
    expect(
      m.toolRuns?.find((r) => r.name === 'research_write' && r.status === 'start')
        ?.results?.[0]?.body || '',
    ).toBe('');
  });

  it('quality-gate rewrite keeps prior draft on settled Write step', () => {
    let m = createResearchAssistantMessage({
      id: 'a8b',
      jobId: 'rs_8b',
      query: 'x',
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'writing', detail: 'drafting report' },
    });
    m = applyResearchEvent(m, {
      kind: 'report_delta',
      payload: { replace: '## 用户问题直答\n第一版草案' },
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'writing', detail: 'rewriting after quality gate (attempt 2)' },
    });
    const writes = m.toolRuns?.filter((r) => r.name === 'research_write') || [];
    expect(writes).toHaveLength(2);
    expect(writes[0]?.status).toBe('done');
    expect(writes[0]?.results?.[0]?.body).toContain('第一版草案');
    expect(writes[1]?.status).toBe('start');
    expect(writes[1]?.query).toContain('rewriting');
    expect(m.content || '').toBe('');
  });

  it('report event promotes draft to content when Output file is missing', () => {
    let m = createResearchAssistantMessage({
      id: 'a8c',
      jobId: 'rs_8c',
      query: 'x',
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'writing', detail: 'drafting report' },
    });
    m = applyResearchEvent(m, {
      kind: 'report_delta',
      payload: { replace: '## 用户问题直答\n完整报告' },
    });
    m = applyResearchEvent(m, {
      kind: 'report',
      payload: { chars: 20 },
    });
    expect(m.incomplete).toBe(false);
    expect(m.content).toContain('完整报告');
  });

  it('file event promotes final report into the answer bubble', () => {
    let m = createResearchAssistantMessage({
      id: 'a8d',
      jobId: 'rs_8d',
      query: 'x',
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'writing', detail: 'drafting report' },
    });
    m = applyResearchEvent(m, {
      kind: 'report_delta',
      payload: { text: '草案中' },
    });
    m = applyResearchEvent(m, {
      kind: 'file',
      payload: {
        id: 'f-final',
        name: 'research_report.md',
        mimeType: 'text/markdown',
        size: 12,
        url: 'local://f-final',
        content: '## 用户问题直答\n定稿',
      },
    });
    expect(m.content).toContain('定稿');
    expect(m.incomplete).toBe(false);
    expect(m.content).not.toContain('草案中');
  });

  it('skips Verify stage chrome for resuming saved verification', () => {
    let m = createResearchAssistantMessage({
      id: 'a9',
      jobId: 'rs_9',
      query: 'x',
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'verifying', detail: 'fact-checking synthesis' },
    });
    const stages = (m.activity || []).filter((s) => s.kind === 'stage').length;
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'verifying', detail: 'resuming saved verification' },
    });
    expect((m.activity || []).filter((s) => s.kind === 'stage')).toHaveLength(stages);
    expect(m.toolRuns?.filter((r) => r.name === 'research_verify')).toHaveLength(1);
  });

  it('withResearchReport clears Continue state and does not append orphan Write', () => {
    let m = createResearchAssistantMessage({
      id: 'a6',
      jobId: 'rs_6',
      query: '腿抽筋',
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'writing', detail: 'drafting report' },
    });
    m = applyResearchEvent(m, {
      kind: 'report_delta',
      payload: { text: '## 用户问题直答\n答案' },
    });
    expect(m.content || '').toBe('');
    expect(
      m.toolRuns?.find((r) => r.name === 'research_write')?.results?.[0]?.body,
    ).toContain('答案');
    m = withResearchReport(m, '## 用户问题直答\n完整报告', {
      id: 'f1',
      name: 'research_report.md',
      mimeType: 'text/markdown',
      size: 12,
      url: 'local://f1',
      content: '## 用户问题直答\n完整报告',
    });
    expect(m.incomplete).toBe(false);
    expect(m.truncationReason).toBeUndefined();
    expect(m.research?.status).toBe('done');
    expect(m.content).toContain('完整报告');
    expect(m.toolRuns?.filter((r) => r.name === 'research_write')).toHaveLength(1);
    const writeIdx = (m.activity || []).findIndex(
      (s) =>
        s.kind === 'tool' &&
        m.toolRuns?.find((r) => r.id === (s as { toolRunId: string }).toolRunId)
          ?.name === 'research_write',
    );
    expect((m.activity || []).some((s) => s.kind === 'content')).toBe(false);
    expect(writeIdx).toBeGreaterThanOrEqual(0);
  });

  it('does not open new stages for resume checkpoint skips', () => {
    let m = createResearchAssistantMessage({
      id: 'a7',
      jobId: 'rs_7',
      query: '腿抽筋',
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'planning', detail: 'planning research outline' },
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'searching', detail: 'searching 2 queries' },
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'synthesizing', detail: 'cross-source synthesis' },
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'verifying', detail: 'fact-checking synthesis' },
    });
    m = applyResearchEvent(m, {
      kind: 'error',
      payload: { message: 'LLM HTTP 524' },
    });
    const stagesBefore = (m.activity || []).filter((s) => s.kind === 'stage').length;
    expect(stagesBefore).toBe(4);

    // Continue / resume walks checkpoints — must not duplicate Plan/Search/…
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'planning', detail: 'claimed' },
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'planning', detail: 'resuming saved plan' },
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'searching', detail: 'resuming saved sources' },
    });
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'synthesizing', detail: 'resuming saved synthesis' },
    });
    expect((m.activity || []).filter((s) => s.kind === 'stage')).toHaveLength(stagesBefore);

    // Real verify retry reuses the existing Verify panel (same stage title)
    // and starts a new verify tool under it — no duplicate stage chrome.
    m = applyResearchEvent(m, {
      kind: 'phase',
      payload: { status: 'verifying', detail: 'fact-checking synthesis' },
    });
    expect((m.activity || []).filter((s) => s.kind === 'stage')).toHaveLength(stagesBefore);
    expect(m.research?.status).toBe('verifying');
    expect(m.toolRuns?.some((r) => r.name === 'research_verify' && r.status === 'start')).toBe(
      true,
    );
  });
});
