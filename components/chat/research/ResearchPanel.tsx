'use client';

import { ChevronDown, FlaskConical, Square, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResearchEvent, ResearchJob, ResearchMode } from '@/hooks/chat/use-deep-research';

type ResearchPanelProps = {
  expanded: boolean;
  onToggleExpanded: () => void;
  enabled: boolean;
  mode: ResearchMode;
  onModeChange: (m: ResearchMode) => void;
  job: ResearchJob | null;
  events: ResearchEvent[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
};

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  planning: '规划中',
  searching: '检索中',
  verifying: '核查中',
  writing: '撰写中',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export function ResearchPanel({
  expanded,
  onToggleExpanded,
  enabled,
  mode,
  onModeChange,
  job,
  events,
  busy,
  error,
  onCancel,
}: ResearchPanelProps) {
  const status = job?.status || (enabled ? '待机' : '关闭');
  const label = STATUS_LABEL[String(status)] || String(status);

  return (
    <div className="rounded-xl border border-stone-200/80 dark:border-stone-800 overflow-hidden">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-stone-50 dark:hover:bg-stone-800/50"
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-500">
          <FlaskConical className="h-3.5 w-3.5" />
          Deep Research
          {job ? (
            <span className="normal-case font-medium text-stone-700 dark:text-stone-300">
              · {label}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-stone-400 transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded ? (
        <div className="border-t border-stone-100 dark:border-stone-800 px-3 py-3 space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-stone-500">模式</span>
            {(['quick', 'standard', 'rigorous'] as ResearchMode[]).map((m) => (
              <button
                key={m}
                type="button"
                disabled={busy}
                onClick={() => onModeChange(m)}
                className={cn(
                  'rounded-md px-2 py-1 text-xs border',
                  mode === m
                    ? 'border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
                    : 'border-stone-200 text-stone-600 dark:border-stone-700 dark:text-stone-300',
                  busy && 'opacity-50',
                )}
              >
                {m}
              </button>
            ))}
            {busy ? (
              <button
                type="button"
                onClick={onCancel}
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50 dark:border-stone-700"
              >
                <Square className="h-3 w-3" />
                取消
              </button>
            ) : null}
          </div>

          {!enabled ? (
            <p className="text-xs text-stone-500">
              在输入框旁打开「深度研究」后发送，将走独立研究管线（规划→检索→核查→报告）。
            </p>
          ) : null}

          {error ? (
            <p className="text-xs text-red-600 dark:text-red-400 break-words">{error}</p>
          ) : null}

          {job ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                <span>{label}</span>
                {job.phaseDetail ? (
                  <span className="text-stone-400 truncate">· {job.phaseDetail}</span>
                ) : null}
              </div>
              {typeof job.tier1Count === 'number' ? (
                <p className="text-xs text-stone-500">Tier1 来源：{job.tier1Count}</p>
              ) : null}
              {job.summaryMarkdown ? (
                <div className="rounded-lg bg-stone-50 dark:bg-stone-900/50 p-2 text-xs whitespace-pre-wrap max-h-40 overflow-auto">
                  {job.summaryMarkdown}
                </div>
              ) : null}
              {job.reportMarkdown ? (
                <details className="text-xs">
                  <summary className="cursor-pointer text-stone-600 dark:text-stone-300">
                    查看完整报告（{job.reportMarkdown.length} 字）
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap max-h-80 overflow-auto rounded-lg bg-stone-50 dark:bg-stone-900/50 p-2 font-sans">
                    {job.reportMarkdown}
                  </pre>
                </details>
              ) : null}
              {events.length > 0 ? (
                <details className="text-xs text-stone-500">
                  <summary className="cursor-pointer">事件日志（{events.length}）</summary>
                  <ul className="mt-1 space-y-0.5 max-h-32 overflow-auto">
                    {events.slice(-20).map((ev, i) => (
                      <li key={`${ev.kind}-${i}`}>
                        <span className="font-medium">{ev.kind}</span>
                        {ev.payload?.detail || ev.payload?.status || ev.payload?.query
                          ? ` · ${String(ev.payload.detail || ev.payload.status || ev.payload.query)}`
                          : ''}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
