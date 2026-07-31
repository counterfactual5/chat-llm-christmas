'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ListOrdered, Play, X } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type ComposerQueuedTask = {
  id: string;
  content: string;
};

type ComposerQueuePanelProps = {
  activeQueue: ComposerQueuedTask[];
  queueExpanded: boolean;
  setQueueExpanded: (value: boolean | ((previous: boolean) => boolean)) => void;
  queuePaused: boolean;
  resumeQueue: () => void;
  clearQueue: () => void;
  jumpQueueAndSubmit: (taskId: string) => void;
  cancelQueuedMessage: (taskId: string) => void;
};

export function ComposerQueuePanel({
  activeQueue,
  queueExpanded,
  setQueueExpanded,
  queuePaused,
  resumeQueue,
  clearQueue,
  jumpQueueAndSubmit,
  cancelQueuedMessage,
}: ComposerQueuePanelProps) {
  const { t } = useLocale();

  return (
    <AnimatePresence>
      {activeQueue.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="mb-3 overflow-hidden rounded-2xl border border-stone-200/80 bg-white/90 shadow-sm backdrop-blur-sm dark:border-stone-700/80 dark:bg-stone-900/90"
        >
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-stone-100 dark:border-stone-800">
            <button
              type="button"
              onClick={() => setQueueExpanded((v) => !v)}
              className="flex min-w-0 items-center gap-2 text-left"
            >
              <ListOrdered className="h-3.5 w-3.5 shrink-0 text-stone-400" />
              <span className="text-xs font-medium text-stone-700 dark:text-stone-300">
                {activeQueue.length} {t('queued')}
              </span>
              {queuePaused && (
                <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  {t('queuePaused')}
                </span>
              )}
              <ChevronDown
                className={cn(
                  'h-3 w-3 shrink-0 text-stone-400 transition-transform',
                  queueExpanded ? 'rotate-180' : '',
                )}
              />
            </button>
            <div className="flex items-center gap-1 shrink-0">
              {queuePaused && (
                <button
                  type="button"
                  onClick={resumeQueue}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-950/30"
                >
                  <Play className="h-3 w-3 fill-current" />
                  {t('resumeQueue')}
                </button>
              )}
              <button
                type="button"
                onClick={clearQueue}
                className="rounded-lg px-2 py-1 text-xs text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300"
              >
                {t('clear')}
              </button>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {queueExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="max-h-36 overflow-y-auto"
              >
                <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                  {activeQueue.map((task, idx) => (
                    <li
                      key={task.id}
                      className="group flex items-center gap-2 px-3 py-1.5 text-sm"
                    >
                      <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-stone-400">
                        {idx + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-stone-600 dark:text-stone-300">
                        {task.content}
                      </span>
                      <button
                        type="button"
                        onClick={() => jumpQueueAndSubmit(task.id)}
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-orange-600 opacity-70 hover:bg-orange-50 hover:opacity-100 group-hover:opacity-100 dark:text-orange-400 dark:hover:bg-orange-950/30"
                      >
                        Send
                      </button>
                      <button
                        type="button"
                        onClick={() => cancelQueuedMessage(task.id)}
                        className="shrink-0 rounded-md p-0.5 text-stone-300 opacity-70 hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-950/20"
                        title="Remove"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
