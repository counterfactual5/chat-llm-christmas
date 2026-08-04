'use client';

import { AnswerMarkdown } from '@/components/chat/message/AnswerMarkdown';
import type { ToolViewPayload } from '@/lib/tools/views/types';
import type { DocxExtractViewData } from '@/lib/tools/views/types';

function asExtractData(data: unknown): DocxExtractViewData {
  if (!data || typeof data !== 'object') return { sections: [] };
  const sections = (data as DocxExtractViewData).sections;
  if (!Array.isArray(sections)) return { sections: [] };
  return {
    sections: sections.map((s) => ({
      title: typeof s?.title === 'string' ? s.title : undefined,
      markdown: String(s?.markdown ?? ''),
    })),
  };
}

export function DocxExtractView({ view }: { view: ToolViewPayload }) {
  const { sections } = asExtractData(view.data);
  if (!sections.length) {
    return (
      <p className="px-4 py-6 text-xs text-stone-400">No extracted sections.</p>
    );
  }
  return (
    <div className="space-y-6 px-4 py-4">
      {sections.map((section, i) => (
        <section key={i} className="min-w-0">
          {section.title ? (
            <h3 className="mb-2 text-sm font-semibold text-stone-800 dark:text-stone-100">
              {section.title}
            </h3>
          ) : null}
          {section.markdown.trim() ? (
            <AnswerMarkdown text={section.markdown} streaming={false} />
          ) : (
            <p className="text-xs text-stone-400">(empty)</p>
          )}
        </section>
      ))}
    </div>
  );
}
