'use client';

import { useLocale } from '@/lib/i18n';
import type { ToolViewPayload, DocxOutlineViewData } from '@/lib/tools/views/types';

function asOutlineData(data: unknown): DocxOutlineViewData {
  if (!data || typeof data !== 'object') return { headings: [] };
  const headings = (data as DocxOutlineViewData).headings;
  if (!Array.isArray(headings)) return { headings: [] };
  return {
    headings: headings.map((h) => ({
      level: typeof h?.level === 'number' ? h.level : 1,
      text: String(h?.text ?? ''),
    })),
  };
}

export function DocxOutlineView({ view }: { view: ToolViewPayload }) {
  const { t } = useLocale();
  const { headings } = asOutlineData(view.data);
  if (!headings.length) {
    return (
      <p className="px-4 py-6 text-xs leading-relaxed text-stone-400">
        {t('toolViewEmptyOutline')}
      </p>
    );
  }
  return (
    <ul className="space-y-1.5 px-4 py-4">
      {headings.map((h, i) => (
        <li
          key={i}
          className="text-sm text-stone-700 dark:text-stone-200"
          style={{ paddingLeft: `${Math.max(0, Math.min(h.level, 6) - 1) * 12}px` }}
        >
          <span className="mr-2 font-mono text-[10px] text-stone-400">H{h.level}</span>
          {h.text || '(untitled)'}
        </li>
      ))}
    </ul>
  );
}
