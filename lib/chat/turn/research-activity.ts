/**
 * Map Deep Research SSE events onto a normal assistant Message
 * (activity / toolRuns / content) so the main chat timeline can render them.
 */

import type { Message, MessageActivityStep, MessageToolRun } from '@/lib/chat/types';

export type ResearchSseEvent = {
  kind: string;
  payload: Record<string, unknown>;
};

const STAGE_TITLE: Record<string, string> = {
  planning: 'Plan',
  searching: 'Search',
  synthesizing: 'Synthesize',
  verifying: 'Verify',
  writing: 'Write',
};

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function ensureActivity(m: Message): MessageActivityStep[] {
  return [...(m.activity || [])];
}

function ensureTools(m: Message): MessageToolRun[] {
  return [...(m.toolRuns || [])];
}

function openStage(m: Message, title: string): Message {
  const activity = ensureActivity(m);
  // Already inside this stage (tools may follow the stage marker).
  for (let i = activity.length - 1; i >= 0; i--) {
    const step = activity[i];
    if (step.kind === 'stage') {
      if (step.title === title) return m;
      break;
    }
  }
  activity.push({ id: newId('stage'), kind: 'stage', title });
  return { ...m, activity, incomplete: true };
}

function hasPendingTool(m: Message, name: string): boolean {
  return ensureTools(m).some((r) => r.name === name && r.status === 'start');
}

function startTool(
  m: Message,
  name: string,
  query?: string,
  provider?: string,
): { message: Message; toolRunId: string } {
  // Idempotent: repeated phase events must not spawn duplicate pending runs.
  const existing = ensureTools(m).find((r) => r.name === name && r.status === 'start');
  if (existing) {
    return { message: m, toolRunId: existing.id };
  }
  const toolRunId = newId('tr');
  const toolRuns = [
    ...ensureTools(m),
    {
      id: toolRunId,
      name,
      status: 'start' as const,
      query,
      provider,
    },
  ];
  const activity = ensureActivity(m);
  activity.push({ id: newId('act'), kind: 'tool', toolRunId });
  return {
    message: { ...m, toolRuns, activity, incomplete: true },
    toolRunId,
  };
}

function finishTool(
  m: Message,
  opts: {
    name: string;
    query?: string;
    provider?: string;
    results?: MessageToolRun['results'];
    error?: string;
    /** Prefer matching this pending id when known. */
    toolRunId?: string;
    /** When true, do not mark the message incomplete (final research settle). */
    keepComplete?: boolean;
  },
): Message {
  const toolRuns = ensureTools(m);
  let idx = -1;
  if (opts.toolRunId) {
    idx = toolRuns.findIndex((r) => r.id === opts.toolRunId && r.status === 'start');
  }
  if (idx < 0) {
    idx = toolRuns.findIndex(
      (r) =>
        r.name === opts.name &&
        r.status === 'start' &&
        (opts.query == null || r.query === opts.query),
    );
  }
  if (idx < 0) {
    idx = toolRuns.findIndex((r) => r.name === opts.name && r.status === 'start');
  }
  if (idx >= 0) {
    toolRuns[idx] = {
      ...toolRuns[idx],
      status: 'done',
      provider: opts.provider ?? toolRuns[idx].provider,
      results: opts.results,
      error: opts.error,
      query: opts.query ?? toolRuns[idx].query,
    };
    return {
      ...m,
      toolRuns,
      incomplete: opts.keepComplete ? m.incomplete : true,
    };
  }
  // Already finished earlier (e.g. settleOpenTools before attaching the file).
  // Update that run in place — never append an orphan tool after the answer,
  // or Write reappears below the report in the timeline.
  const doneIdx = toolRuns.findIndex((r) => r.name === opts.name && r.status === 'done');
  if (doneIdx >= 0) {
    toolRuns[doneIdx] = {
      ...toolRuns[doneIdx],
      provider: opts.provider ?? toolRuns[doneIdx].provider,
      results: opts.results ?? toolRuns[doneIdx].results,
      error: opts.error ?? toolRuns[doneIdx].error,
      query: opts.query ?? toolRuns[doneIdx].query,
    };
    return { ...m, toolRuns };
  }
  // No prior run — append a completed one.
  const toolRunId = newId('tr');
  toolRuns.push({
    id: toolRunId,
    name: opts.name,
    status: 'done',
    query: opts.query,
    provider: opts.provider,
    results: opts.results,
    error: opts.error,
  });
  const activity = ensureActivity(m);
  activity.push({ id: newId('act'), kind: 'tool', toolRunId });
  return {
    ...m,
    toolRuns,
    activity,
    incomplete: opts.keepComplete ? m.incomplete : true,
  };
}

function settleOpenTools(m: Message, error?: string): Message {
  const toolRuns = ensureTools(m).map((r) =>
    r.status === 'start'
      ? {
          ...r,
          status: 'done' as const,
          // Soft-close without a scary error when the pipeline moves on.
          ...(error ? { error: r.error || error } : r.error ? {} : {}),
        }
      : r,
  );
  return { ...m, toolRuns };
}

function appendReasoning(m: Message, text: string): Message {
  const t = String(text || '').trim();
  if (!t) return m;
  const activity = ensureActivity(m);
  const last = activity[activity.length - 1];
  if (last?.kind === 'reasoning') {
    activity[activity.length - 1] = {
      ...last,
      text: `${last.text}${last.text ? '\n' : ''}${t}`,
    };
    return {
      ...m,
      reasoning: `${m.reasoning || ''}${m.reasoning ? '\n' : ''}${t}`,
      activity,
      incomplete: true,
    };
  }
  activity.push({ id: newId('rs'), kind: 'reasoning', text: t });
  return {
    ...m,
    reasoning: `${m.reasoning || ''}${m.reasoning ? '\n' : ''}${t}`,
    activity,
    incomplete: true,
  };
}

function formatPlanText(plan: unknown): string {
  if (!plan || typeof plan !== 'object') return '';
  const p = plan as {
    subQuestions?: unknown;
    searchQueries?: unknown;
    notes?: unknown;
  };
  const lines: string[] = [];
  if (Array.isArray(p.subQuestions) && p.subQuestions.length) {
    lines.push('Sub-questions:');
    for (const q of p.subQuestions) lines.push(`- ${String(q)}`);
  }
  if (Array.isArray(p.searchQueries) && p.searchQueries.length) {
    lines.push('Search queries:');
    for (const q of p.searchQueries) lines.push(`- ${String(q)}`);
  }
  if (p.notes) lines.push(String(p.notes));
  return lines.join('\n');
}

/**
 * Apply one research SSE event to the in-progress assistant message.
 */
export function applyResearchEvent(
  message: Message,
  event: ResearchSseEvent,
): Message {
  const { kind, payload } = event;
  let m = message;

  if (kind === 'phase') {
    const status = String(payload.status || '');
    const detail = typeof payload.detail === 'string' ? payload.detail : '';
    if (
      status === 'planning' ||
      status === 'searching' ||
      status === 'synthesizing' ||
      status === 'verifying' ||
      status === 'writing'
    ) {
      m = openStage(m, STAGE_TITLE[status] || status);
      m = {
        ...m,
        incomplete: true,
        truncationReason: undefined,
        research: m.research
          ? { ...m.research, status }
          : undefined,
      };
      if (status === 'planning') {
        if (!hasPendingTool(m, 'research_plan')) {
          m = startTool(m, 'research_plan', detail || 'planning research outline').message;
        } else if (detail && detail !== 'claimed') {
          const toolRuns = ensureTools(m).map((run) =>
            run.name === 'research_plan' && run.status === 'start'
              ? { ...run, query: detail }
              : run,
          );
          m = { ...m, toolRuns };
        }
      } else if (status === 'synthesizing') {
        m = settleOpenTools(m);
        if (!hasPendingTool(m, 'research_synthesize')) {
          m = startTool(
            m,
            'research_synthesize',
            detail || 'cross-source synthesis',
          ).message;
        }
      } else if (status === 'verifying') {
        m = settleOpenTools(m);
        if (!hasPendingTool(m, 'research_verify')) {
          m = startTool(m, 'research_verify', detail || 'fact-checking synthesis').message;
        }
      } else if (status === 'writing') {
        m = settleOpenTools(m);
        if (!hasPendingTool(m, 'research_write')) {
          m = startTool(m, 'research_write', detail || 'drafting report').message;
        }
      }
    } else if (status === 'failed' || status === 'cancelled') {
      const err =
        status === 'cancelled'
          ? 'Research cancelled'
          : String(payload.message || m.truncationReason || 'Research failed');
      m = settleOpenTools(m, err);
      m = {
        ...m,
        incomplete: true,
        truncationReason: err,
        research: m.research ? { ...m.research, status } : m.research,
      };
    } else if (status === 'done') {
      m = settleOpenTools(m);
      m = {
        ...m,
        incomplete: false,
        truncationReason: undefined,
        research: m.research ? { ...m.research, status: 'done' } : m.research,
      };
    }
    return m;
  }

  if (kind === 'plan') {
    m = finishTool(m, {
      name: 'research_plan',
      provider: 'research',
      results: [
        {
          title: 'Research plan',
          url: '',
          snippet: formatPlanText(payload) || JSON.stringify(payload).slice(0, 500),
        },
      ],
    });
    const notes = formatPlanText(payload);
    if (notes) m = appendReasoning(m, notes);
    return m;
  }

  if (kind === 'search') {
    const query = String(payload.query || '');
    const status = String(payload.status || '');
    if (status === 'start') {
      const started = startTool(m, 'web_search', query, String(payload.provider || '') || undefined);
      return started.message;
    }
    if (status === 'ok' || status === 'empty') {
      const count = Number(payload.count || 0);
      const provider = String(payload.provider || 'none');
      const rawError = status === 'empty' ? String(payload.error || '').trim() : '';
      // Soft empty (provider returned zero hits) must not show as Failed.
      // Hard failures (HTTP/config) keep the error string for the red label.
      const softEmpty =
        !rawError ||
        /:\s*empty\b/i.test(rawError) ||
        /no results/i.test(rawError) ||
        /未返回|无结果|empty result/i.test(rawError);
      const error =
        status === 'empty' && rawError && !softEmpty ? rawError : undefined;
      const hits = Array.isArray(payload.hits) ? payload.hits : [];
      const results =
        hits.length > 0
          ? hits
              .map((h) => {
                const row = h as { title?: unknown; url?: unknown; snippet?: unknown };
                return {
                  title: String(row.title || row.url || ''),
                  url: String(row.url || ''),
                  snippet: String(row.snippet || ''),
                };
              })
              .filter((h) => /^https?:\/\//i.test(h.url))
          : undefined;
      return finishTool(m, {
        name: 'web_search',
        query,
        provider,
        error,
        results:
          results && results.length
            ? results
            : count > 0
              ? undefined // counts-only — no browseable URL for Reference Material
              : undefined,
      });
    }
    return m;
  }

  if (kind === 'read') {
    const url = String(payload.url || '');
    const chars = Number(payload.chars || 0);
    // Reads are direct URL fetches — no search provider. Do not label as
    // "via research" (that was a placeholder and confused the timeline).
    return finishTool(m, {
      name: 'web_read',
      query: url,
      results: /^https?:\/\//i.test(url)
        ? [{ title: url, url, snippet: chars ? `${chars} chars` : 'ok' }]
        : undefined,
    });
  }

  if (kind === 'sources') {
    const count = Number(payload.count || 0);
    const tier1 = payload.tier1Count != null ? Number(payload.tier1Count) : null;
    m = appendReasoning(
      m,
      `Collected ${count} sources${tier1 != null ? ` (${tier1} Tier 1)` : ''}.`,
    );
    const items = Array.isArray(payload.items) ? payload.items : [];
    const results = items
      .map((row) => {
        const r = row as {
          title?: unknown;
          url?: unknown;
          snippet?: unknown;
          query?: unknown;
        };
        return {
          title: String(r.title || r.url || ''),
          url: String(r.url || ''),
          snippet: String(r.snippet || ''),
          query: r.query != null ? String(r.query) : undefined,
        };
      })
      .filter((h) => /^https?:\/\//i.test(h.url));
    if (results.length) {
      const toolRuns = ensureTools(m);
      const existingIdx = toolRuns.findIndex((r) => r.name === 'research_sources');
      const toolRunId =
        existingIdx >= 0 ? toolRuns[existingIdx].id : newId('tr');
      const run: MessageToolRun = {
        id: toolRunId,
        name: 'research_sources',
        status: 'done',
        provider: 'research',
        query: 'collected sources',
        results: results.map(({ title, url, snippet }) => ({ title, url, snippet })),
      };
      if (existingIdx >= 0) {
        toolRuns[existingIdx] = run;
      } else {
        toolRuns.push(run);
        const activity = ensureActivity(m);
        activity.push({ id: newId('act'), kind: 'tool', toolRunId });
        m = { ...m, activity };
      }
      m = { ...m, toolRuns, incomplete: true };
    }
    return m;
  }

  if (kind === 'synthesis') {
    const chars = Number(payload.chars || 0);
    const preview =
      typeof payload.preview === 'string' ? String(payload.preview).trim() : '';
    return finishTool(m, {
      name: 'research_synthesize',
      provider: 'research',
      results: [
        {
          title: 'Synthesis',
          url: '',
          snippet: preview
            ? `${chars} chars · ${preview.slice(0, 160)}`
            : `${chars} chars`,
        },
      ],
    });
  }

  if (kind === 'verified') {
    return finishTool(m, {
      name: 'research_verify',
      provider: 'research',
      results: [
        {
          title: 'Verified facts',
          url: '',
          snippet: `${Number(payload.chars || 0)} chars`,
        },
      ],
    });
  }

  if (kind === 'report_reset') {
    return {
      ...m,
      content: '',
      incomplete: true,
    };
  }

  if (kind === 'report_delta') {
    const replace =
      typeof payload.replace === 'string' ? String(payload.replace) : null;
    if (replace != null) {
      return { ...m, content: replace, incomplete: true };
    }
    const text = String(payload.text || '');
    if (!text) return m;
    return {
      ...m,
      content: `${m.content || ''}${text}`,
      incomplete: true,
    };
  }

  if (kind === 'file') {
    const id = String(payload.id || '');
    if (!id) return m;
    const file = {
      id,
      name: String(payload.name || 'research-report.md'),
      mimeType: String(payload.mimeType || 'text/markdown'),
      size: Number(payload.size) || 0,
      url: String(payload.url || `local://${id}`),
      content:
        typeof payload.content === 'string' ? String(payload.content) : undefined,
      createdAt: Number(payload.createdAt) || Date.now(),
    };
    const files = [...(m.files || [])].filter((f) => f.id !== id);
    files.push(file);
    const activity = ensureActivity(m);
    if (!activity.some((s) => s.kind === 'file' && s.fileId === id)) {
      activity.push({ id: newId('file'), kind: 'file', fileId: id });
    }
    const researchDone = m.research?.status === 'done';
    return finishTool(
      { ...m, files, activity },
      {
        name: 'research_write',
        provider: 'research',
        keepComplete: researchDone,
        results: [
          {
            title: file.name,
            url: '',
            snippet: `${file.mimeType} · ${file.size} bytes`,
          },
        ],
      },
    );
  }

  if (kind === 'quality') {
    const ok = Boolean(payload.ok);
    const errors = Array.isArray(payload.errors) ? payload.errors.map(String) : [];
    if (!ok && errors.length) {
      return appendReasoning(m, `Quality gate: ${errors.join('; ')}`);
    }
    return m;
  }

  if (kind === 'report') {
    m = finishTool(m, {
      name: 'research_write',
      provider: 'research',
      results: [
        {
          title: 'Report',
          url: '',
          snippet: `${Number(payload.chars || 0)} chars`,
        },
      ],
    });
    return m;
  }

  if (kind === 'error') {
    const msg = String(payload.message || 'Research failed');
    m = settleOpenTools(m, msg);
    return {
      ...m,
      incomplete: true,
      truncationReason: msg,
      research: m.research ? { ...m.research, status: 'failed' } : m.research,
    };
  }

  return m;
}

/** Seed an empty assistant bubble that will receive research events. */
export function createResearchAssistantMessage(opts: {
  id: string;
  jobId: string;
  query: string;
  mode?: string;
}): Message {
  return {
    id: opts.id,
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    incomplete: true,
    activity: [],
    toolRuns: [],
    research: {
      jobId: opts.jobId,
      query: opts.query,
      mode: opts.mode,
      status: 'queued',
    },
  };
}

/** Attach final report markdown as the answer content (and optional Output file). */
export function withResearchReport(
  message: Message,
  reportMarkdown: string,
  reportFile?: {
    id: string;
    name?: string;
    mimeType?: string;
    size?: number;
    url?: string;
    content?: string;
    createdAt?: number;
  } | null,
): Message {
  const content = String(reportMarkdown || '').trim();
  if (!content) return message;

  // Mark done first so the file attach path does not re-open Write or flip
  // incomplete back to true (that left Continue showing after a finished report).
  let m: Message = {
    ...settleOpenTools(message),
    content,
    incomplete: false,
    truncationReason: undefined,
    research: message.research
      ? { ...message.research, status: 'done' }
      : message.research,
  };

  // Do not append a duplicate `content` activity step at the end — streamed
  // report body already lives on message.content, and buildTimelineSegments
  // places it after Process panels. Pushing content here put the answer in the
  // middle of the timeline and let an orphan Write tool land below it.

  if (reportFile?.id) {
    m = applyResearchEvent(m, { kind: 'file', payload: reportFile as Record<string, unknown> });
  }

  // Final authority: completed research is never "interrupted".
  return {
    ...m,
    content,
    incomplete: false,
    truncationReason: undefined,
    research: m.research ? { ...m.research, status: 'done' } : m.research,
  };
}
