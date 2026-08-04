'use client';

import type { ToolViewPayload } from '@/lib/tools/views/types';

/** Fallback for unknown / unsupported viewType. */
export function UnsupportedToolView({ view }: { view: ToolViewPayload }) {
  let json = '';
  try {
    json = JSON.stringify(view.data, null, 2);
  } catch {
    json = String(view.data);
  }
  return (
    <div className="space-y-3 px-4 py-4">
      <p className="text-xs text-stone-500">
        Unsupported view type: <code className="font-mono">{view.viewType || 'unknown'}</code>
      </p>
      <pre className="max-h-[60vh] overflow-auto rounded-lg bg-stone-50 p-3 text-[11px] leading-4 text-stone-600 dark:bg-stone-950/60 dark:text-stone-300">
        {json || '(no data)'}
      </pre>
    </div>
  );
}
