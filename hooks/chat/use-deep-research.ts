'use client';

/**
 * Deep Research client: create job, stream SSE, patch the assistant
 * message in the main chat timeline (Plan / Search / Synthesize / Verify / Write).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatSession, Message } from '@/lib/chat/types';
import {
  applyResearchEvent,
  createResearchAssistantMessage,
  withResearchReport,
} from '@/lib/chat/turn/research-activity';

export type ResearchMode = 'quick' | 'standard' | 'rigorous';

export type ResearchJob = {
  jobId: string;
  sessionId?: string | null;
  query: string;
  mode: ResearchMode;
  status: string;
  phaseDetail?: string | null;
  reportMarkdown?: string | null;
  summaryMarkdown?: string | null;
  reportFile?: {
    id: string;
    name?: string;
    mimeType?: string;
    size?: number;
    url?: string;
    content?: string;
    createdAt?: number;
  } | null;
  error?: string | null;
  model?: string | null;
};

type StartOpts = {
  query: string;
  mode: ResearchMode;
  sessionId: string;
  model?: string;
  /** Existing assistant bubble to reuse (Continue / retry). */
  assistantId?: string;
};

type PatchSessions = (
  updater: (prev: ChatSession[]) => ChatSession[],
) => void;

function patchAssistant(
  setSessions: PatchSessions,
  sessionId: string,
  assistantId: string,
  fn: (m: Message) => Message,
) {
  setSessions((prev) =>
    prev.map((s) => {
      if (s.id !== sessionId) return s;
      return {
        ...s,
        updatedAt: Date.now(),
        messages: s.messages.map((m) => (m.id === assistantId ? fn(m) : m)),
      };
    }),
  );
}

export function useDeepResearch(opts: {
  setSessions: PatchSessions;
  beginLoading: (sessionId: string) => void;
  endLoading: (sessionId: string) => void;
}) {
  const { setSessions, beginLoading, endLoading } = opts;
  const [mode, setMode] = useState<ResearchMode>('standard');
  const [job, setJob] = useState<ResearchJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef<{
    jobId: string;
    sessionId: string;
    assistantId: string;
  } | null>(null);

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const refreshJob = useCallback(async (jobId: string) => {
    const res = await fetch(`/api/research/${encodeURIComponent(jobId)}`, {
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
    }
    const j = data.data as ResearchJob;
    setJob(j);
    return j;
  }, []);

  const listen = useCallback(
    async (jobId: string, sessionId: string, assistantId: string) => {
      stopStream();
      const ac = new AbortController();
      abortRef.current = ac;
      activeRef.current = { jobId, sessionId, assistantId };
      try {
        const res = await fetch(
          `/api/research/${encodeURIComponent(jobId)}/stream?last_event_id=0`,
          { signal: ac.signal, cache: 'no-store' },
        );
        if (!res.ok || !res.body) {
          const t = await res.text().catch(() => '');
          throw new Error(t.slice(0, 200) || `stream HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let eventKind = 'message';
        let dataLines: string[] = [];

        const flush = () => {
          if (!dataLines.length) {
            eventKind = 'message';
            return;
          }
          const raw = dataLines.join('\n');
          dataLines = [];
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(raw);
          } catch {
            payload = { raw };
          }
          const kind = eventKind || 'message';
          eventKind = 'message';

          patchAssistant(setSessions, sessionId, assistantId, (m) =>
            applyResearchEvent(m, { kind, payload }),
          );

          if (kind === 'phase' && typeof payload.status === 'string') {
            setJob((prev) =>
              prev
                ? {
                    ...prev,
                    status: String(payload.status),
                    phaseDetail:
                      typeof payload.detail === 'string'
                        ? payload.detail
                        : prev.phaseDetail,
                  }
                : prev,
            );
          }
          if (kind === 'error' && payload.message) {
            setError(String(payload.message));
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split(/\r?\n/);
          buf = parts.pop() || '';
          for (const line of parts) {
            if (line.startsWith('event:')) {
              eventKind = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trimStart());
            } else if (line === '') {
              flush();
            }
          }
        }
        flush();

        const finalJob = await refreshJob(jobId).catch(() => null);
        if (finalJob?.status === 'done' && finalJob.reportMarkdown) {
          patchAssistant(setSessions, sessionId, assistantId, (m) =>
            withResearchReport(m, finalJob.reportMarkdown || '', finalJob.reportFile),
          );
        } else if (finalJob?.status === 'failed') {
          const msg = finalJob.error || 'Research failed';
          setError(msg);
          patchAssistant(setSessions, sessionId, assistantId, (m) =>
            applyResearchEvent(m, {
              kind: 'error',
              payload: { message: msg },
            }),
          );
        }
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === 'AbortError') {
          patchAssistant(setSessions, sessionId, assistantId, (m) => ({
            ...m,
            incomplete: true,
            truncationReason: m.truncationReason || 'Research interrupted',
          }));
          return;
        }
        // Stream drop ≠ job failure — server may still be running. Keep last
        // research.status so Continue can reattach instead of starting over.
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        patchAssistant(setSessions, sessionId, assistantId, (m) => ({
          ...m,
          incomplete: true,
          truncationReason: msg || 'Research stream interrupted',
        }));
      } finally {
        setBusy(false);
        endLoading(sessionId);
        if (activeRef.current?.jobId === jobId) activeRef.current = null;
      }
    },
    [endLoading, refreshJob, setSessions, stopStream],
  );

  /** Reconnect to an existing job and rebuild the bubble from SSE replay. */
  const reattach = useCallback(
    async (opts: {
      jobId: string;
      sessionId: string;
      assistantId: string;
      query: string;
      mode: ResearchMode;
    }) => {
      const { jobId, sessionId, assistantId, query, mode } = opts;
      setError(null);
      setBusy(true);
      beginLoading(sessionId);
      setJob({
        jobId,
        sessionId,
        query,
        mode,
        status: 'queued',
      });
      // Reset timeline then replay all events for a consistent Process panel.
      patchAssistant(setSessions, sessionId, assistantId, () =>
        createResearchAssistantMessage({ id: assistantId, jobId, query, mode }),
      );
      await listen(jobId, sessionId, assistantId);
    },
    [beginLoading, listen, setSessions],
  );

  /**
   * Continue an interrupted research turn: reattach if still running, otherwise
   * ask the backend to resume the same job from checkpoints (do not create a new job).
   */
  const resume = useCallback(
    async (opts: {
      jobId: string;
      sessionId: string;
      assistantId: string;
      query: string;
      mode: ResearchMode;
    }) => {
      const { jobId, sessionId, assistantId, query, mode } = opts;
      setError(null);
      try {
        let remote = await refreshJob(jobId).catch(() => null);
        const running = new Set([
          'queued',
          'planning',
          'searching',
          'synthesizing',
          'verifying',
          'writing',
        ]);
        if (remote?.status === 'done') {
          const report = remote.reportMarkdown || '';
          const file = remote.reportFile;
          if (report) {
            patchAssistant(setSessions, sessionId, assistantId, (m) =>
              withResearchReport(m, report, file),
            );
          }
          return remote;
        }
        if (remote && running.has(String(remote.status))) {
          await reattach({ jobId, sessionId, assistantId, query, mode });
          return remote;
        }

        const res = await fetch(`/api/research/${encodeURIComponent(jobId)}/resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.success === false) {
          throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
        }
        remote = (data.data as ResearchJob) || remote;
        await reattach({ jobId, sessionId, assistantId, query, mode });
        return remote;
      } catch (err: unknown) {
        setBusy(false);
        endLoading(sessionId);
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [endLoading, reattach, refreshJob, setSessions],
  );

  const start = useCallback(
    async (startOpts: StartOpts) => {
      const query = String(startOpts.query || '').trim();
      if (!query) {
        setError('请输入研究问题');
        return null;
      }
      const sessionId = startOpts.sessionId;
      setError(null);
      setBusy(true);
      beginLoading(sessionId);

      try {
        const res = await fetch('/api/research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            mode: startOpts.mode,
            sessionId,
            model: startOpts.model,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.success === false) {
          throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
        }
        const jobId = String(data?.data?.jobId || '');
        if (!jobId) throw new Error('未返回 jobId');

        const assistantId =
          startOpts.assistantId || `research_${jobId}_${Date.now()}`;

        const seeded = createResearchAssistantMessage({
          id: assistantId,
          jobId,
          query,
          mode: startOpts.mode,
        });

        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            const msgs = [...s.messages];
            const idx = msgs.findIndex((m) => m.id === assistantId);
            if (idx >= 0) {
              msgs[idx] = seeded;
            } else {
              msgs.push(seeded);
            }
            return { ...s, updatedAt: Date.now(), messages: msgs };
          }),
        );

        const created: ResearchJob = {
          jobId,
          query,
          mode: startOpts.mode,
          status: 'queued',
          sessionId,
          model: startOpts.model,
        };
        setJob(created);
        void listen(jobId, sessionId, assistantId);
        return { ...created, assistantId };
      } catch (err: unknown) {
        setBusy(false);
        endLoading(sessionId);
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [beginLoading, endLoading, listen, setSessions],
  );

  const cancel = useCallback(async () => {
    const active = activeRef.current;
    const jobId = active?.jobId || job?.jobId;
    if (!jobId) return;
    try {
      await fetch(`/api/research/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
      });
      stopStream();
      if (active) {
        patchAssistant(setSessions, active.sessionId, active.assistantId, (m) =>
          applyResearchEvent(m, {
            kind: 'phase',
            payload: { status: 'cancelled' },
          }),
        );
        endLoading(active.sessionId);
      }
      await refreshJob(jobId).catch(() => null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [endLoading, job?.jobId, refreshJob, setSessions, stopStream]);

  useEffect(() => () => stopStream(), [stopStream]);

  return {
    mode,
    setMode,
    job,
    busy,
    error,
    start,
    cancel,
    resume,
    reattach,
    active: activeRef,
  };
}
