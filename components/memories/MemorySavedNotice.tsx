'use client';

import { Brain, X } from 'lucide-react';

type MemorySavedNoticeProps = {
  count: number;
  label: string;
  viewLabel: string;
  onView: () => void;
  onDismiss: () => void;
};

/** Compact notice shown under the Review layer after auto-extract saves memories. */
export function MemorySavedNotice({
  count,
  label,
  viewLabel,
  onView,
  onDismiss,
}: MemorySavedNoticeProps) {
  if (count <= 0) return null;

  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-stone-200/80 bg-stone-50/80 px-2.5 py-2 text-[12px] text-stone-600 dark:border-stone-800 dark:bg-stone-900/50 dark:text-stone-300">
      <Brain className="h-3.5 w-3.5 shrink-0 text-stone-500" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <button
        type="button"
        onClick={onView}
        className="shrink-0 font-medium text-stone-800 underline-offset-2 hover:underline dark:text-stone-100"
      >
        {viewLabel}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded p-0.5 text-stone-400 hover:bg-stone-200/70 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
