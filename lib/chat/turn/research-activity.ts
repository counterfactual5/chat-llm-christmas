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

/** Gather sub-stages opened from tool events (not from phase status alone). */
const STAGE_SEARCH = 'Search';
const STAGE_READ = 'Read';
const STAGE_SOURCES = 'Sources';

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
  // Idempotent per name+query: parallel web_read/web_search must not collapse
  // into a single pending run when several URLs/queries are in flight.
  const existing = ensureTools(m).find(
    (r) =>
      r.name === name &&
      r.status === 'start' &&
      (query == null || query === '' ? !r.query : r.query === query),
  );
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

/** Stream writer drafts into the pending research_write tool — never the answer bubble. */
function ensurePendingWrite(m: Message, query?: string): Message {
  if (hasPendingTool(m, 'research_write')) return m;
  return startTool(m, 'research_write', query || 'drafting report').message;
}

function patchWriteDraft(
  m: Message,
  next: { mode: 'clear' | 'append' | 'replace'; text?: string },
): Message {
  let out = ensurePendingWrite(m);
  const toolRuns = ensureTools(out);
  const idx = toolRuns.findIndex((r) => r.name === 'research_write' && r.status === 'start');
  if (idx < 0) return out;
  const run = toolRuns[idx];
  const prev = run.results?.[0];
  let body = String(prev?.body || '');
  if (next.mode === 'clear') body = '';
  else if (next.mode === 'replace') body = String(next.text || '');
  else body = `${body}${next.text || ''}`;
  toolRuns[idx] = {
    ...run,
    results: [
      {
        title: prev?.title || 'Draft',
        url: '',
        snippet: prev?.snippet || '',
        body,
      },
    ],
  };
  return { ...out, toolRuns, incomplete: true };
}

function pendingWriteDraftBody(m: Message): string {
  const pending = ensureTools(m).find(
    (r) => r.name === 'research_write' && r.status === 'start',
  );
  return String(pending?.results?.[0]?.body || '').trim();
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
    // Continue from checkpoints briefly walks planning/search/synthesize again
    // with "resuming saved …" — do not open new Process panels for those skips
    // or Continue looks like a full restart.
    const isCheckpointSkip =
      /^resuming\s+saved\b/i.test(detail) ||
      (detail === 'claimed' &&
        (m.activity || []).some((s) => s.kind === 'stage'));
    if (
      status === 'queued' ||
      status === 'planning' ||
      status === 'searching' ||
      status === 'synthesizing' ||
      status === 'verifying' ||
      status === 'writing'
    ) {
      if (status === 'queued') {
        return {
          ...m,
          incomplete: true,
          truncationReason: undefined,
          research: m.research
            ? { ...m.research, status: 'queued' }
            : m.research,
        };
      }
      if (isCheckpointSkip) {
        return {
          ...m,
          incomplete: true,
          truncationReason: undefined,
          research: m.research ? { ...m.research, status } : m.research,
        };
      }
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
      m = openStage(m, STAGE_SEARCH);
      const started = startTool(
        m,
        'web_search',
        query,
        String(payload.provider || '') || undefined,
      );
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
    const sourceKind = String(payload.sourceKind || 'web').toLowerCase();
    const sourceProvider = String(payload.sourceProvider || '').trim();
    const title = String(payload.title || '').trim();
    const status = String(payload.status || 'ok').toLowerCase();
    // Academic enrichments are still HTTP fetches, but the timeline should not
    // look like a generic "Read webpage" when the hit came from OpenAlex/arXiv.
    const toolName =
      sourceKind === 'paper' ||
      /^(openalex|arxiv|semantic|semantic-scholar|s2)$/i.test(sourceProvider)
        ? 'paper_read'
        : 'web_read';
    if (status === 'start') {
      m = openStage(m, STAGE_READ);
      return startTool(m, toolName, url || title || undefined, sourceProvider || undefined)
        .message;
    }
    const errorRaw = String(payload.error || '').trim();
    if (status === 'error' || status === 'failed') {
      return finishTool(m, {
        name: toolName,
        query: url || undefined,
        provider: sourceProvider || undefined,
        error: humanizeReadError(errorRaw),
        results: /^https?:\/\//i.test(url)
          ? [
              {
                title: title || url,
                url,
                snippet: '',
              },
            ]
          : undefined,
      });
    }
    return finishTool(m, {
      name: toolName,
      query: url || undefined,
      provider: sourceProvider || undefined,
      results: /^https?:\/\//i.test(url)
        ? [
            {
              title: title || url,
              url,
              snippet: chars ? `${chars} chars` : 'ok',
            },
          ]
        : undefined,
    });
  }

  if (kind === 'sources') {
    const count = Number(payload.count || 0);
    const tier1 = payload.tier1Count != null ? Number(payload.tier1Count) : null;
    const reads = payload.reads != null ? Number(payload.reads) : null;
    const readAttempts =
      payload.readAttempts != null ? Number(payload.readAttempts) : null;
    const readBits: string[] = [];
    if (tier1 != null) readBits.push(`${tier1} Tier 1`);
    if (reads != null && readAttempts != null && readAttempts > 0) {
      readBits.push(`read ${reads}/${readAttempts} pages`);
    } else if (reads != null) {
      readBits.push(`read ${reads}`);
    }
    const items = Array.isArray(payload.items) ? payload.items : [];
    const results = items
      .map((row) => {
        const r = row as {
          title?: unknown;
          url?: unknown;
          snippet?: unknown;
          query?: unknown;
          hasExcerpt?: unknown;
        };
        const hasExcerpt = Boolean(r.hasExcerpt);
        const titleBase = String(r.title || r.url || '');
        return {
          title: hasExcerpt ? titleBase : `${titleBase} · 仅摘要`,
          url: String(r.url || ''),
          snippet: hasExcerpt
            ? String(r.snippet || '')
            : [String(r.snippet || '').trim(), '（未读到正文）'].filter(Boolean).join(' '),
          query: r.query != null ? String(r.query) : undefined,
        };
      })
      .filter((h) => /^https?:\/\//i.test(h.url));
    // Open Sources first so the summary Thought + tool land here, not under Read.
    m = openStage(m, STAGE_SOURCES);
    m = appendReasoning(
      m,
      `Collected ${count} sources${readBits.length ? ` (${readBits.join(', ')})` : ''}.`,
    );
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
        // Label is i18n `collectedSources`; no redundant query subtitle.
        query: '',
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

  if (kind === 'synthesis_quality') {
    const ok = Boolean(payload.ok);
    const attempt = Number(payload.attempt || 0) || 0;
    const errors = Array.isArray(payload.errors) ? payload.errors.map(String) : [];
    if (!ok && errors.length) {
      const label =
        attempt > 1
          ? `Synthesis gate (attempt ${attempt})`
          : 'Synthesis gate';
      return appendReasoning(m, `${label}: ${errors.join('; ')}`);
    }
    return m;
  }

  if (kind === 'synthesis') {
    const chars = Number(payload.chars || 0);
    const preview =
      typeof payload.preview === 'string' ? String(payload.preview).trim() : '';
    // Prefer a readable body preview in Process; keep snippet short for the row.
    const body = preview.slice(0, 800);
    return finishTool(m, {
      name: 'research_synthesize',
      provider: 'research',
      results: [
        {
          title: 'Synthesis',
          url: '',
          snippet: chars ? `${chars} chars` : 'ready',
          ...(body ? { body } : {}),
        },
      ],
    });
  }

  if (kind === 'verified_quality') {
    const ok = Boolean(payload.ok);
    const attempt = Number(payload.attempt || 0) || 0;
    const errors = Array.isArray(payload.errors) ? payload.errors.map(String) : [];
    if (!ok && errors.length) {
      const label =
        attempt > 1
          ? `Verify gate (attempt ${attempt})`
          : 'Verify gate';
      return appendReasoning(m, `${label}: ${errors.join('; ')}`);
    }
    return m;
  }

  if (kind === 'verified') {
    const chars = Number(payload.chars || 0);
    const preview =
      typeof payload.preview === 'string' ? String(payload.preview).trim() : '';
    const body = preview.slice(0, 800);
    const ok = payload.ok == null ? true : Boolean(payload.ok);
    const errors = Array.isArray(payload.errors) ? payload.errors.map(String) : [];
    const gate = ok
      ? 'passed'
      : errors.length
        ? errors.slice(0, 2).join('; ')
        : 'issues';
    return finishTool(m, {
      name: 'research_verify',
      provider: 'research',
      results: [
        {
          title: 'Verified facts',
          url: '',
          snippet: chars ? `${chars} chars · ${gate}` : gate,
          ...(body ? { body } : {}),
        },
      ],
    });
  }

  if (kind === 'report_reset') {
    // Clear the in-progress Write draft only — do not yank text from the
    // answer bubble (drafts never lived there; retries must not flash-clear).
    return patchWriteDraft(m, { mode: 'clear' });
  }

  if (kind === 'report_delta') {
    const replace =
      typeof payload.replace === 'string' ? String(payload.replace) : null;
    if (replace != null) {
      return patchWriteDraft(m, { mode: 'replace', text: replace });
    }
    const text = String(payload.text || '');
    if (!text) return m;
    return patchWriteDraft(m, { mode: 'append', text });
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
    // Final report lands with the Output file — promote into the answer bubble
    // now. Intermediate writer attempts stay in Write tool drafts only.
    const reportBody = String(file.content || '').trim() || pendingWriteDraftBody(m);
    const researchDone = m.research?.status === 'done' || Boolean(reportBody);
    return finishTool(
      {
        ...m,
        files,
        activity,
        ...(reportBody
          ? {
              content: reportBody,
              incomplete: false,
              truncationReason: undefined,
              research: m.research
                ? { ...m.research, status: 'done' as const }
                : m.research,
            }
          : {}),
      },
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
    // Final report settle — do not flip incomplete back to true (Continue
    // would reappear after a finished research run).
    const draft = pendingWriteDraftBody(m);
    const content = String(m.content || '').trim() || draft;
    const researchDone =
      m.research?.status === 'done' || Boolean(content);
    m = finishTool(
      content && !String(m.content || '').trim()
        ? {
            ...m,
            content,
            research: m.research
              ? { ...m.research, status: 'done' }
              : m.research,
          }
        : m,
      {
        name: 'research_write',
        provider: 'research',
        keepComplete: researchDone,
        results: [
          {
            title: 'Report',
            url: '',
            snippet: `${Number(payload.chars || 0)} chars`,
          },
        ],
      },
    );
    if (researchDone) {
      return {
        ...m,
        content: String(m.content || '').trim() || content,
        incomplete: false,
        truncationReason: undefined,
        research: m.research ? { ...m.research, status: 'done' } : m.research,
      };
    }
    return m;
  }

  if (kind === 'error') {
    const errors = Array.isArray(payload.errors) ? payload.errors.map(String).filter(Boolean) : [];
    const msg =
      String(payload.message || '').trim() ||
      (errors.length ? errors.join('; ') : 'Research failed');
    // Prefer the joined gate errors when the SSE stub is just "quality gate failed".
    const detail =
      errors.length && /quality gate failed/i.test(msg) && !/Tier|来源|阅读/i.test(msg)
        ? `质量门禁未通过: ${errors.join('; ')}`
        : errors.length && msg && !errors.some((e) => msg.includes(e))
          ? `${msg}: ${errors.join('; ')}`
          : msg;
    m = settleOpenTools(m, detail);
    // Failed runs keep drafts under Write tools — clear any partial bubble
    // text so the quality-gate reason is not mixed into a half-finished report.
    const hasResearchFile = (m.files || []).some(
      (f) =>
        String(f.name || '').startsWith('research_') ||
        String(f.url || '').startsWith('local://local_research_') ||
        String(f.url || '').startsWith('local://research'),
    );
    return {
      ...m,
      content: hasResearchFile ? m.content : '',
      incomplete: true,
      truncationReason: humanizeResearchError(detail),
      research: m.research ? { ...m.research, status: 'failed' } : m.research,
    };
  }

  if (kind === 'heartbeat') {
    // Keep-alive only — do not mutate timeline.
    return m;
  }

  return m;
}

/** Turn gateway HTML / 524 noise into a short user-facing reason. */
export function humanizeResearchError(raw: string): string {
  const msg = String(raw || '').trim();
  if (!msg) return 'Research failed';
  if (/LLM HTTP 524|524 non-JSON|Cloudflare|A timeout occurred/i.test(msg)) {
    return '模型网关超时（524）。点 Continue 可从已保存进度继续。';
  }
  if (/LLM HTTP 502|LLM HTTP 503|LLM HTTP 504/i.test(msg)) {
    return '模型网关暂时不可用。点 Continue 可重试。';
  }
  // Strip HTML dumped after "non-JSON:"
  const cut = msg.split(/non-JSON:/i)[0].trim();
  return (cut || msg).slice(0, 240);
}

/** Short label for a failed research page enrich (web_read / paper_read). */
export function humanizeReadError(raw: string): string {
  const msg = String(raw || '').trim();
  if (!msg) return '无法读取正文';
  if (/Invalid, missing, or blocked URL/i.test(msg)) return '链接无效或已屏蔽';
  if (/All readers failed/i.test(msg)) return '无法抓取正文（阅读器均失败）';
  if (/timed out|timeout/i.test(msg)) return '读取超时';
  if (/\b403\b|\b401\b|paywall|login|captcha|forbidden/i.test(msg)) {
    return '页面需登录或禁止抓取';
  }
  if (/empty|no extractable|too short/i.test(msg)) return '页面无可提取正文';
  // Multi-provider chain: "zhipu: … | tavily: …" → keep the first clause.
  const first = msg.split(/\s*\|\s*/)[0]?.trim() || msg;
  return first.slice(0, 160);
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

  // Do not append a duplicate `content` activity step at the end — the final
  // report lives on message.content (promoted from file/report), while writer
  // drafts stayed on research_write tool results. buildTimelineSegments places
  // the answer after Process panels.

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
