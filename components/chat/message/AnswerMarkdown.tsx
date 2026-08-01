/* eslint-disable @typescript-eslint/no-explicit-any -- react-markdown renderer props are intentionally loose. */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { CodeBlock } from '@/components/markdown/code/code-block';
import { expandLiteralBreaks } from '@/lib/markdown/core/breaks';
import { unwrapMarkdownDocumentFence } from '@/lib/markdown/core/document-fence';
import { looksLikeAsciiArt, reflowCollapsedAsciiArt } from '@/lib/markdown/core/ascii-art';
import { prepareChatMarkdown } from '@/lib/markdown/math';

const KATEX_OPTIONS = {
  throwOnError: false,
  errorColor: 'var(--chat-math-error, #a8a29e)',
} as const;

/** The standard answer/review-fix Markdown presentation used by the chat timeline. */
export function AnswerMarkdown({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div className="chat-markdown w-full text-stone-800 dark:text-stone-200 leading-relaxed text-[15px] space-y-3 [&_sup]:text-[0.7em] [&_sup_a]:text-orange-700 [&_sup_a]:no-underline dark:[&_sup_a]:text-orange-300 [&_section[data-footnotes]]:mt-6 [&_section[data-footnotes]]:border-t [&_section[data-footnotes]]:border-stone-200 [&_section[data-footnotes]]:pt-3 [&_section[data-footnotes]]:text-[13px] [&_section[data-footnotes]]:text-stone-500 dark:[&_section[data-footnotes]]:border-stone-700 dark:[&_section[data-footnotes]]:text-stone-400 [&_section[data-footnotes]_h2]:text-xs [&_section[data-footnotes]_h2]:font-semibold [&_section[data-footnotes]_h2]:uppercase [&_section[data-footnotes]_h2]:tracking-wider [&_section[data-footnotes]_h2]:text-stone-400">
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
        components={{
          p({ children }: any) {
            return <p className="mb-4 whitespace-pre-wrap leading-7 last:mb-0">{children}</p>;
          },
          h1({ children }: any) {
            return <h1 className="text-xl font-bold mt-6 mb-3 text-stone-900 dark:text-stone-100">{children}</h1>;
          },
          h2({ children }: any) {
            return <h2 className="text-lg font-bold mt-5 mb-2.5 text-stone-900 dark:text-stone-100">{children}</h2>;
          },
          h3({ children }: any) {
            return <h3 className="text-base font-bold mt-4 mb-2 text-stone-900 dark:text-stone-100">{children}</h3>;
          },
          ul({ children }: any) {
            return <ul className="my-3 pl-6 list-disc space-y-1">{children}</ul>;
          },
          ol({ children }: any) {
            return <ol className="my-3 pl-6 list-decimal space-y-1">{children}</ol>;
          },
          li({ children }: any) {
            return <li className="leading-6">{children}</li>;
          },
          a({ href, children }: any) {
            return <a href={href} target="_blank" rel="noreferrer" className="text-orange-700 underline decoration-orange-300/80 underline-offset-2 hover:text-orange-800 dark:text-orange-300 dark:decoration-orange-700/80 dark:hover:text-orange-200">{children}</a>;
          },
          blockquote({ children }: any) {
            return <blockquote className="my-3 border-l-[3px] border-stone-300 pl-3 text-[13px] leading-5 text-stone-500 not-italic dark:border-stone-600 dark:text-stone-400 [&_p]:mb-0 [&_p]:leading-5 [&_.katex]:text-[0.95em] [&_.katex-display]:my-2 [&_.katex-error]:text-inherit">{children}</blockquote>;
          },
          table({ children }: any) {
            return <div className="my-4 w-full overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-800"><table className="w-full text-left text-sm">{children}</table></div>;
          },
          thead({ children }: any) {
            return <thead className="bg-stone-100 dark:bg-stone-900 text-stone-900 dark:text-stone-100 font-semibold">{children}</thead>;
          },
          tbody({ children }: any) {
            return <tbody className="divide-y divide-stone-200 dark:divide-stone-800">{children}</tbody>;
          },
          tr({ children }: any) {
            return <tr className="hover:bg-stone-50/50 dark:hover:bg-stone-900/50">{children}</tr>;
          },
          th({ children }: any) {
            return <th className="px-3.5 py-2.5 font-semibold [&_p]:my-0 [&_blockquote]:my-0 [&_ul]:my-1 [&_ol]:my-1">{expandLiteralBreaks(children)}</th>;
          },
          td({ children }: any) {
            return <td className="px-3.5 py-2.5 align-top [&_p]:my-0 [&_blockquote]:my-0 [&_ul]:my-1 [&_ol]:my-1">{expandLiteralBreaks(children)}</td>;
          },
          code({ className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            let value = String(children).replace(/\n$/, '');
            const asciiArt = looksLikeAsciiArt(value);
            if (asciiArt) value = reflowCollapsedAsciiArt(value);
            const isBlock = Boolean(match) || value.includes('\n') || (asciiArt && value.length >= 12);
            if (isBlock && match) return <CodeBlock language={match[1]} value={value} />;
            if (isBlock) return <pre className="my-4 overflow-x-auto whitespace-pre rounded-lg bg-stone-100 p-4 font-mono text-[13px] leading-5 text-stone-800 dark:bg-stone-900/60 dark:text-stone-300"><code {...props}>{value}</code></pre>;
            return <code {...props} className="rounded bg-stone-200/60 px-1.5 py-0.5 text-xs font-mono text-stone-900 dark:bg-stone-800 dark:text-stone-100">{children}</code>;
          },
          pre({ children }: any) {
            return <>{children}</>;
          },
          sup({ children }: any) {
            return <sup className="ml-0.5 font-medium">{children}</sup>;
          },
        }}
      >
        {prepareChatMarkdown(unwrapMarkdownDocumentFence(text), { streaming })}
      </ReactMarkdown>
    </div>
  );
}
