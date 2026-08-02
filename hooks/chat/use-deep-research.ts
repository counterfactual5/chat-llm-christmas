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
  humanizeResearchError,
  withResearchReport,
} from '@/lib/chat/turn/research-activity';

export type ResearchMode = 'quick' | 'standard' | 'rigorous';
export type ResearchSources = 'web' | 'literature' | 'mixed';

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
  sources?: ResearchSources;
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

  /**
   * Stream drops usually coincide with network blips — a single failed status
   * probe must not decide the job's fate. Retry briefly before giving up.
   */
  const refreshJobWithRetry = useCallback(
    async (jobId: string, attempts = 2): Promise<ResearchJob | null> => {
      for (let i = 0; i < attempts; i++) {
        const j = await refreshJob(jobId).catch(() => null);
        if (j) return j;
        if (i < attempts - 1) {
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
      return null;
    },
    [refreshJob],
  );

  const listen = useCallback(
    async (
      jobId: string,
      sessionId: string,
      assistantId: string,
      opts?: {
        /**
         * Rebuild timeline off-screen from SSE replay, then swap once.
         * Avoids the Continue flash where Process clears then reappears.
         */
        deferUiUntilCatchUp?: boolean;
        seed?: { query: string; mode: ResearchMode };
      },
    ) => {
      stopStream();
      const ac = new AbortController();
      abortRef.current = ac;
      activeRef.current = { jobId, sessionId, assistantId };
      const deferUi = Boolean(opts?.deferUiUntilCatchUp);
      let rebuilt: Message = createResearchAssistantMessage({
        id: assistantId,
        jobId,
        query: opts?.seed?.query || '',
        mode: opts?.seed?.mode,
      });
      let uiLive = !deferUi;
      let sawEvent = false;
      let catchUpTimer: ReturnType<typeof setTimeout> | null = null;
      let reattachAfterDrop = false;

      const commitCatchUp = () => {
        if (uiLive) return;
        uiLive = true;
        if (catchUpTimer) {
          clearTimeout(catchUpTimer);
          catchUpTimer = null;
        }
        // No replay yet — keep the visible timeline instead of wiping it empty.
        if (!sawEvent) return;
        // Preserve the existing bubble id/timestamp; replace activity in one paint.
        patchAssistant(setSessions, sessionId, assistantId, (m) => ({
          ...rebuilt,
          id: m.id,
          timestamp: m.timestamp || rebuilt.timestamp,
          research:
            rebuilt.research && !rebuilt.research.query && m.research?.query
              ? { ...rebuilt.research, query: m.research.query, mode: m.research.mode }
              : rebuilt.research,
        }));
        const st = String(rebuilt.research?.status || '');
        if (
          st === 'queued' ||
          st === 'planning' ||
          st === 'searching' ||
          st === 'synthesizing' ||
          st === 'verifying' ||
          st === 'writing' ||
          st === 'done'
        ) {
          setError(null);
        } else if (st === 'failed' || st === 'cancelled') {
          setError(rebuilt.truncationReason || 'Research failed');
        }
      };

      const scheduleCatchUpCommit = () => {
        if (uiLive) return;
        if (catchUpTimer) clearTimeout(catchUpTimer);
        // Historical events arrive in a burst; commit after the burst settles.
        catchUpTimer = setTimeout(commitCatchUp, 80);
      };

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

          rebuilt = applyResearchEvent(rebuilt, { kind, payload });
          sawEvent = true;

          if (uiLive) {
            patchAssistant(setSessions, sessionId, assistantId, (m) =>
              applyResearchEvent(m, { kind, payload }),
            );
          } else {
            scheduleCatchUpCommit();
          }

          if (kind === 'phase' && typeof payload.status === 'string') {
            const status = String(payload.status);
            setJob((prev) =>
              prev
                ? {
                    ...prev,
                    status,
                    phaseDetail:
                      typeof payload.detail === 'string'
                        ? payload.detail
                        : prev.phaseDetail,
                  }
                : prev,
            );
            // A later running/queued phase supersedes any historical timeout error
            // replayed from SSE catch-up (Continue after "job timed out").
            if (
              status === 'queued' ||
              status === 'planning' ||
              status === 'searching' ||
              status === 'synthesizing' ||
              status === 'verifying' ||
              status === 'writing' ||
              status === 'done'
            ) {
              setError(null);
            }
          }
          if (kind === 'error' && payload.message) {
            // During catch-up, ignore stale errors — the latest phase wins above.
            // Only surface errors that arrive while the UI is live.
            if (uiLive) setError(humanizeResearchError(String(payload.message)));
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
        commitCatchUp();

        const finalJob = await refreshJobWithRetry(jobId);
        if (finalJob?.status === 'done' && finalJob.reportMarkdown) {
          patchAssistant(setSessions, sessionId, assistantId, (m) =>
            withResearchReport(m, finalJob.reportMarkdown || '', finalJob.reportFile),
          );
        } else if (finalJob?.status === 'failed') {
          const msg = humanizeResearchError(finalJob.error || 'Research failed');
          setError(msg);
          patchAssistant(setSessions, sessionId, assistantId, (m) =>
            applyResearchEvent(m, {
              kind: 'error',
              payload: { message: finalJob.error || msg },
            }),
          );
        } else if (
          finalJob &&
          ['queued', 'planning', 'searching', 'synthesizing', 'verifying', 'writing'].includes(
            String(finalJob.status),
          )
        ) {
          // Proxies often close long SSE without throwing on the client. The job
          // is still running (e.g. Verify done → Write) — reattach instead of
          // stamping a fake "Reply was interrupted".
          setError(null);
          patchAssistant(setSessions, sessionId, assistantId, (m) => ({
            ...m,
            incomplete: false,
            truncationReason: undefined,
            research: m.research
              ? { ...m.research, status: String(finalJob.status) }
              : m.research,
          }));
          reattachAfterDrop = true;
        }
      } catch (err: unknown) {
        if (catchUpTimer) {
          clearTimeout(catchUpTimer);
          catchUpTimer = null;
        }
        if ((err as { name?: string })?.name === 'AbortError') {
          patchAssistant(setSessions, sessionId, assistantId, (m) => ({
            ...m,
            incomplete: true,
            truncationReason: m.truncationReason || 'Research interrupted',
          }));
          return;
        }
        // Stream drop ≠ job failure — server may still be running. Re-check
        // and reattach instead of falsely showing "Reply was interrupted".
        const remote = await refreshJobWithRetry(jobId);
        const running = new Set([
          'queued',
          'planning',
          'searching',
          'synthesizing',
          'verifying',
          'writing',
        ]);
        if (remote && running.has(String(remote.status))) {
          setError(null);
          patchAssistant(setSessions, sessionId, assistantId, (m) => ({
            ...m,
            incomplete: false,
            truncationReason: undefined,
            research: m.research
              ? { ...m.research, status: String(remote.status) }
              : m.research,
          }));
          reattachAfterDrop = true;
          return;
        }
        if (remote?.status === 'done' && remote.reportMarkdown) {
          patchAssistant(setSessions, sessionId, assistantId, (m) =>
            withResearchReport(m, remote.reportMarkdown || '', remote.reportFile),
          );
          return;
        }
        if (remote?.status === 'failed') {
          const msg = humanizeResearchError(remote.error || 'Research failed');
          setError(msg);
          patchAssistant(setSessions, sessionId, assistantId, (m) =>
            applyResearchEvent(m, {
              kind: 'error',
              payload: { message: remote.error || msg },
            }),
          );
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        setError(humanizeResearchError(msg));
        patchAssistant(setSessions, sessionId, assistantId, (m) => ({
          ...m,
          incomplete: true,
          truncationReason: humanizeResearchError(msg) || 'Research stream interrupted',
        }));
      } finally {
        if (catchUpTimer) clearTimeout(catchUpTimer);
        if (reattachAfterDrop) {
          // Job still running — reconnect SSE without clearing the busy state.
          // Defer UI until catch-up: the replay starts from event 0, and applying
          // it on top of the live timeline would duplicate stages/tool runs.
          // Small delay avoids hammering a proxy that closes SSE immediately.
          setTimeout(() => {
            if (activeRef.current?.jobId !== jobId) return;
            void listen(jobId, sessionId, assistantId, {
              deferUiUntilCatchUp: true,
              seed: opts?.seed,
            });
          }, 800);
          return;
        }
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
      // Keep the existing Process timeline visible while SSE catch-up rebuilds
      // off-screen; only clear incomplete/error chrome so Continue feels live.
      patchAssistant(setSessions, sessionId, assistantId, (m) => ({
        ...m,
        incomplete: false,
        truncationReason: undefined,
        research: {
          ...(m.research || { jobId, query, mode }),
          jobId,
          query,
          mode,
          status: 'queued',
        },
      }));
      await listen(jobId, sessionId, assistantId, {
        deferUiUntilCatchUp: true,
        seed: { query, mode },
      });
    },
    [beginLoading, listen, setSessions],
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
            sources: startOpts.sources || 'web',
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
        void listen(jobId, sessionId, assistantId, {
          seed: { query, mode: startOpts.mode },
        });
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
      setBusy(true);
      beginLoading(sessionId);
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
            return remote;
          }
          // Marked done but no report body — force a checkpoint resume/rewrite.
        }
        if (remote && running.has(String(remote.status))) {
          setBusy(false);
          endLoading(sessionId);
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
          const msg = String(data?.error || data?.message || `HTTP ${res.status}`);
          // Old backends without /resume: fall back to a fresh job on the same bubble.
          if (res.status === 404 || /not found|找不到|Cannot POST|404/i.test(msg)) {
            setBusy(false);
            endLoading(sessionId);
            const created = await start({
              query,
              mode,
              sessionId,
              assistantId,
            });
            if (!created) {
              throw new Error(msg || '无法恢复研究任务');
            }
            return created;
          }
          throw new Error(msg);
        }
        remote = (data.data as ResearchJob) || remote;
        setBusy(false);
        endLoading(sessionId);
        await reattach({ jobId, sessionId, assistantId, query, mode });
        return remote;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        patchAssistant(setSessions, sessionId, assistantId, (m) => ({
          ...m,
          incomplete: true,
          truncationReason: msg || 'Failed to continue research',
        }));
        return null;
      } finally {
        // reattach/start manage their own busy flag while listening; only clear
        // when we finished synchronously (done report) or errored out.
        if (!activeRef.current) {
          setBusy(false);
          endLoading(sessionId);
        }
      }
    },
    [beginLoading, endLoading, reattach, refreshJob, setSessions, start],
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
      // Also blocks the delayed SSE reconnect scheduled after a stream drop.
      activeRef.current = null;
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

  useEffect(
    () => () => {
      stopStream();
      // Prevent the delayed post-drop reconnect from firing after unmount.
      activeRef.current = null;
    },
    [stopStream],
  );

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
