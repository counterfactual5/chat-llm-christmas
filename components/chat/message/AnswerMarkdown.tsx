/* eslint-disable @typescript-eslint/no-explicit-any -- react-markdown renderer props are intentionally loose. */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { AsciiArtPre } from '@/components/markdown/code/ascii-art-pre';
import { CodeBlock } from '@/components/markdown/code/code-block';
import { expandLiteralBreaks } from '@/lib/markdown/core/breaks';
import { unwrapMarkdownDocumentFence } from '@/lib/markdown/core/document-fence';
import { looksLikeAsciiArt, reflowCollapsedAsciiArt } from '@/lib/markdown/core/ascii-art';
import { prepareChatMarkdown } from '@/lib/markdown/math';
import {
  isPreviewableHttpUrl,
  shouldOpenLinkExternally,
} from '@/lib/files/url-preview';
import { cn } from '@/lib/utils';

const KATEX_OPTIONS = {
  throwOnError: false,
  errorColor: 'var(--chat-math-error, #a8a29e)',
} as const;

/** Slash commands that should send when clicked in assistant markdown. */
export function isClickableSlashCommand(text: string): boolean {
  const s = String(text || '').trim();
  if (/^\/books\s+download\s+\S+/i.test(s)) return true;
  if (/^\/papers\s+download\s+\S+/i.test(s)) return true;
  if (/^\/papers\s+(details|citations|references)\s+\S+/i.test(s)) return true;
  return false;
}

/** The standard answer/review-fix Markdown presentation used by the chat timeline. */
export function AnswerMarkdown({
  text,
  streaming,
  onSendCommand,
  onPreviewLink,
  reflowBlocks = true,
  className,
}: {
  text: string;
  streaming: boolean;
  /** Send a slash command as a new user turn (e.g. /books download …). */
  onSendCommand?: (command: string) => void;
  /** Open an http(s) link in the side Preview panel (Cmd/Ctrl-click still opens a tab). */
  onPreviewLink?: (url: string) => void;
  /**
   * Restore smashed headings/lists/tables. Thought/CoT keeps this off —
   * English verifier prose is easily shredded by answer-oriented reflow.
   */
  reflowBlocks?: boolean;
  /** Extra classes on the outer wrapper (e.g. denser Thought chrome). */
  className?: string;
}) {
  return (
    <div
      className={cn(
        // overflow-wrap:anywhere for prose; tables opt out so wide cells scroll
        // horizontally instead of shredding (see SpreadsheetTable).
        'chat-markdown w-full min-w-0 max-w-full overflow-x-hidden text-stone-800 dark:text-stone-200 leading-relaxed text-[15px] space-y-3 [overflow-wrap:anywhere] [&_table]:[overflow-wrap:normal] [&_sup]:text-[0.7em] [&_sup_a]:text-orange-700 [&_sup_a]:no-underline dark:[&_sup_a]:text-orange-300 [&_section[data-footnotes]]:mt-6 [&_section[data-footnotes]]:border-t [&_section[data-footnotes]]:border-stone-200 [&_section[data-footnotes]]:pt-3 [&_section[data-footnotes]]:text-[13px] [&_section[data-footnotes]]:text-stone-500 dark:[&_section[data-footnotes]]:border-stone-700 dark:[&_section[data-footnotes]]:text-stone-400 [&_section[data-footnotes]_h2]:text-xs [&_section[data-footnotes]_h2]:font-semibold [&_section[data-footnotes]_h2]:uppercase [&_section[data-footnotes]_h2]:tracking-wider [&_section[data-footnotes]_h2]:text-stone-400',
        className,
      )}
    >
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
            const link = String(href || '').trim();
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-orange-700 underline decoration-orange-300/80 underline-offset-2 hover:text-orange-800 dark:text-orange-300 dark:decoration-orange-700/80 dark:hover:text-orange-200"
                onClick={(e) => {
                  if (!onPreviewLink || !isPreviewableHttpUrl(link)) return;
                  if (shouldOpenLinkExternally(e)) return;
                  e.preventDefault();
                  onPreviewLink(link);
                }}
              >
                {children}
              </a>
            );
          },
          blockquote({ children }: any) {
            return <blockquote className="my-3 border-l-[3px] border-stone-300 pl-3 text-[13px] leading-5 text-stone-500 not-italic dark:border-stone-600 dark:text-stone-400 [&_p]:mb-0 [&_p]:leading-5 [&_.katex]:text-[0.95em] [&_.katex-display]:my-2 [&_.katex-error]:text-inherit">{children}</blockquote>;
          },
          table({ children }: any) {
            // Keep wide tables inside this scroller — never expand the chat page.
            // overscroll-x-contain: trackpad horizontal scroll stays here (not the
            // outer overflow-x-hidden message list).
            return (
              <div className="my-4 max-w-full min-w-0 overflow-x-auto overscroll-x-contain rounded-lg border border-stone-200 pb-2 dark:border-stone-800">
                <table className="w-max min-w-full border-collapse text-left text-sm">{children}</table>
              </div>
            );
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
            return <th className="px-3.5 py-2.5 font-semibold whitespace-nowrap [&_p]:my-0 [&_blockquote]:my-0 [&_ul]:my-1 [&_ol]:my-1">{expandLiteralBreaks(children)}</th>;
          },
          td({ children }: any) {
            // Allow wrap + <br> list lines in cells (GFM has no real <ul> in tables).
            // Keep horizontal scroll on the outer wrapper for wide grids.
            return <td className="px-3.5 py-2.5 align-top whitespace-normal break-words [&_p]:my-0 [&_blockquote]:my-0 [&_ul]:my-1 [&_ol]:my-1">{expandLiteralBreaks(children)}</td>;
          },
          code({ className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            let value = String(children).replace(/\n$/, '');
            // Only rewrite when reflow detects a flat/half-glued diagram —
            // well-formed nested boxes and indented trees are left alone.
            if (looksLikeAsciiArt(value)) {
              const next = reflowCollapsedAsciiArt(value);
              if (next !== value) value = next;
            }
            const isBlock =
              Boolean(match) ||
              value.includes('\n') ||
              (looksLikeAsciiArt(value) && value.length >= 12);
            if (isBlock && match) {
              return <CodeBlock language={match[1]} value={value} streaming={streaming} />;
            }
            if (isBlock) {
              if (looksLikeAsciiArt(value)) {
                return (
                  <AsciiArtPre
                    value={value}
                    className="my-4 rounded-lg bg-stone-100 p-4 text-[13px] text-stone-800 dark:bg-stone-900/60 dark:text-stone-300"
                  />
                );
              }
              return (
                <pre className="my-4 max-w-full min-w-0 overflow-x-auto whitespace-pre rounded-lg bg-stone-100 p-4 font-mono text-[13px] leading-5 text-stone-800 [overflow-wrap:normal] dark:bg-stone-900/60 dark:text-stone-300">
                  <code {...props}>{value}</code>
                </pre>
              );
            }
            const cmd = value.trim();
            if (onSendCommand && isClickableSlashCommand(cmd)) {
              return (
                <button
                  type="button"
                  onClick={() => onSendCommand(cmd)}
                  title="Click to send this command"
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-orange-200/80 bg-orange-50 px-1.5 py-0.5 text-left font-mono text-xs text-orange-900 transition-colors hover:border-orange-300 hover:bg-orange-100 dark:border-orange-800/60 dark:bg-orange-950/40 dark:text-orange-100 dark:hover:bg-orange-950/70"
                >
                  <span className="min-w-0 break-all">{cmd}</span>
                </button>
              );
            }
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
        {prepareChatMarkdown(unwrapMarkdownDocumentFence(text), {
          streaming,
          reflowBlocks,
        })}
      </ReactMarkdown>
    </div>
  );
}
