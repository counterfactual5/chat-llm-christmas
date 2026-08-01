'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ResearchMode = 'quick' | 'standard' | 'rigorous';

export type ResearchJob = {
  jobId: string;
  sessionId?: string | null;
  query: string;
  mode: ResearchMode;
  status: string;
  phaseDetail?: string | null;
  plan?: unknown;
  reportMarkdown?: string | null;
  summaryMarkdown?: string | null;
  sources?: unknown[];
  sourcesCount?: number;
  tier1Count?: number | null;
  quality?: {
    ok?: boolean;
    errors?: string[];
    warnings?: string[];
    tier1Count?: number;
  } | null;
  error?: string | null;
  model?: string | null;
};

export type ResearchEvent = {
  seq?: number;
  kind: string;
  payload: Record<string, unknown>;
};

type StartOpts = {
  query: string;
  mode: ResearchMode;
  sessionId?: string;
  model?: string;
};

export function useDeepResearch() {
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<ResearchMode>('standard');
  const [job, setJob] = useState<ResearchJob | null>(null);
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refreshJob = useCallback(async (jobId: string) => {
    const res = await fetch(`/api/research/${encodeURIComponent(jobId)}`, {
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
    }
    setJob(data.data as ResearchJob);
    return data.data as ResearchJob;
  }, []);

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const listen = useCallback(
    async (jobId: string) => {
      stopStream();
      const ac = new AbortController();
      abortRef.current = ac;
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
          setEvents((prev) => [...prev, { kind, payload }]);
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
          if (kind === 'done' || kind === 'phase') {
            const st = String(payload.status || '');
            if (['done', 'failed', 'cancelled'].includes(st)) {
              void refreshJob(jobId).catch(() => undefined);
            }
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
        await refreshJob(jobId);
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [refreshJob, stopStream],
  );

  const start = useCallback(
    async (opts: StartOpts) => {
      const query = String(opts.query || '').trim();
      if (!query) {
        setError('请输入研究问题');
        return null;
      }
      setError(null);
      setEvents([]);
      setBusy(true);
      setJob(null);
      try {
        const res = await fetch('/api/research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            mode: opts.mode,
            sessionId: opts.sessionId,
            model: opts.model,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.success === false) {
          throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
        }
        const jobId = String(data?.data?.jobId || '');
        if (!jobId) throw new Error('未返回 jobId');
        const created: ResearchJob = {
          jobId,
          query,
          mode: opts.mode,
          status: 'queued',
          sessionId: opts.sessionId,
          model: opts.model,
        };
        setJob(created);
        void listen(jobId);
        return created;
      } catch (err: unknown) {
        setBusy(false);
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [listen],
  );

  const cancel = useCallback(async () => {
    if (!job?.jobId) return;
    try {
      await fetch(`/api/research/${encodeURIComponent(job.jobId)}/cancel`, {
        method: 'POST',
      });
      stopStream();
      await refreshJob(job.jobId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [job?.jobId, refreshJob, stopStream]);

  useEffect(() => () => stopStream(), [stopStream]);

  return {
    enabled,
    setEnabled,
    mode,
    setMode,
    job,
    events,
    busy,
    error,
    start,
    cancel,
    refreshJob,
  };
}
