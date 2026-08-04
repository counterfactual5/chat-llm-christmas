/* eslint-disable @typescript-eslint/no-explicit-any -- react-markdown renderer props are intentionally loose. */
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { compactQuoteMath, prepareQuoteMarkdown } from '@/lib/markdown/math';
import { cn } from '@/lib/utils';

const KATEX_OPTIONS = {
  throwOnError: false,
  errorColor: 'var(--chat-math-error, #a8a29e)',
} as const;

/**
 * Lightweight quote chip / user-bubble quote rendering.
 *
 * Not AnswerMarkdown: quotes are previews (math + plain prose), not full
 * answer layout. Skip ascii/mermaid fencing and CodeBlock chrome so box-drawing
 * selections stay compact monospace text instead of a "text / Copy" card.
 */
export function QuoteMarkdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'chat-markdown chat-quote text-[12px] leading-4 text-stone-500 dark:text-stone-400 [&_p]:mb-0 [&_p]:leading-4 [&_.katex]:text-[0.95em] [&_.katex-display]:my-1 [&_.katex-error]:text-inherit',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
        components={{
          p({ children }: any) {
            return <p className="whitespace-pre-wrap">{children}</p>;
          },
          code({ children }: any) {
            const value = String(children).replace(/\n$/, '');
            if (value.includes('\n')) {
              return (
                <pre className="my-0.5 max-w-full overflow-x-auto whitespace-pre font-mono text-[11px] leading-4 text-stone-500 dark:text-stone-400">
                  {value}
                </pre>
              );
            }
            return (
              <code className="rounded bg-stone-200/60 px-1 py-0.5 font-mono text-[11px] dark:bg-stone-800">
                {children}
              </code>
            );
          },
          pre({ children }: any) {
            return <>{children}</>;
          },
        }}
      >
        {prepareQuoteMarkdown(compactQuoteMath(text))}
      </ReactMarkdown>
    </div>
  );
}
