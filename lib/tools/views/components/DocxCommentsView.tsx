'use client';

import { useLocale } from '@/lib/i18n';
import type { ToolViewPayload, DocxCommentsViewData } from '@/lib/tools/views/types';

function asCommentsData(data: unknown): DocxCommentsViewData {
  if (!data || typeof data !== 'object') return { comments: [] };
  const comments = (data as DocxCommentsViewData).comments;
  if (!Array.isArray(comments)) return { comments: [] };
  return {
    comments: comments.map((c) => ({
      id: typeof c?.id === 'string' ? c.id : undefined,
      author: typeof c?.author === 'string' ? c.author : undefined,
      body: String(c?.body ?? ''),
      date: typeof c?.date === 'string' ? c.date : undefined,
    })),
  };
}

export function DocxCommentsView({ view }: { view: ToolViewPayload }) {
  const { t } = useLocale();
  const { comments } = asCommentsData(view.data);
  if (!comments.length) {
    return (
      <p className="px-4 py-6 text-xs leading-relaxed text-stone-400">
        {t('toolViewEmptyComments')}
      </p>
    );
  }
  return (
    <ul className="space-y-3 px-4 py-4">
      {comments.map((c, i) => (
        <li
          key={c.id || i}
          className="rounded-lg border border-stone-200/80 bg-stone-50/60 px-3 py-2 dark:border-stone-800 dark:bg-stone-950/40"
        >
          <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-[11px] text-stone-400">
            {c.author ? (
              <span className="font-medium text-stone-600 dark:text-stone-300">{c.author}</span>
            ) : null}
            {c.date ? <span>{c.date}</span> : null}
          </div>
          <p className="whitespace-pre-wrap text-sm text-stone-700 dark:text-stone-200">
            {c.body || '(empty)'}
          </p>
        </li>
      ))}
    </ul>
  );
}
