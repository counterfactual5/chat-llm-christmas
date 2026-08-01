'use client';

import { useEffect, useMemo } from 'react';
import { Download, FileText, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { CodeBlock } from '@/components/markdown/code/code-block';
import { prepareChatMarkdown } from '@/lib/markdown/math';
import { cn } from '@/lib/utils';

const KATEX_OPTIONS = {
  throwOnError: false,
  errorColor: 'var(--chat-math-error, #a8a29e)',
} as const;

export type FilePreviewPayload = {
  id: string;
  name: string;
  mimeType: string;
  content: string;
  size?: number;
};

const EXT_LANG: Record<string, string> = {
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  jsx: 'javascript',
  json: 'json',
  csv: 'plaintext',
  tsv: 'plaintext',
  yaml: 'yaml',
  yml: 'yaml',
  html: 'xml',
  htm: 'xml',
  css: 'css',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  xml: 'xml',
  toml: 'plaintext',
  ini: 'plaintext',
  env: 'plaintext',
  txt: 'plaintext',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
};

function fileExt(name: string): string {
  const base = String(name || '').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function isMarkdownPreview(file: Pick<FilePreviewPayload, 'name' | 'mimeType'>): boolean {
  const mime = String(file.mimeType || '').toLowerCase();
  if (mime.includes('markdown') || mime === 'text/x-markdown') return true;
  const ext = fileExt(file.name);
  return ext === 'md' || ext === 'markdown';
}

export function languageFromFilename(name: string): string {
  return EXT_LANG[fileExt(name)] || 'plaintext';
}

type FilePreviewOverlayProps = {
  file: FilePreviewPayload | null;
  onClose: () => void;
  onDownload?: (file: FilePreviewPayload) => void;
  labels?: {
    preview?: string;
    download?: string;
    close?: string;
  };
};

/** Pure content renderer (markdown / code) — reused by the fullscreen overlay and the side-panel preview. */
export function FilePreviewContent({ file }: { file: FilePreviewPayload }) {
  const markdown = useMemo(() => isMarkdownPreview(file), [file]);
  const language = useMemo(() => languageFromFilename(file.name), [file]);

  return markdown ? (
    <div
      className={cn(
        'chat-markdown mx-auto max-w-3xl text-[15px] leading-relaxed text-stone-800 dark:text-stone-200',
        '[&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-xl [&_h1]:font-bold',
        '[&_h2]:mb-3 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold',
        '[&_p]:mb-4 [&_p]:leading-7 [&_p:last-child]:mb-0',
        '[&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6',
        '[&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:pl-6',
        '[&_blockquote]:border-l-2 [&_blockquote]:border-stone-300 [&_blockquote]:pl-3 [&_blockquote]:text-stone-500',
        '[&_a]:text-sky-700 [&_a]:underline dark:[&_a]:text-sky-400',
        '[&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-stone-200 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-stone-200 [&_td]:px-2 [&_td]:py-1',
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
        components={{
          code({ className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const value = String(children ?? '').replace(/\n$/, '');
            const inline = !match && !String(children ?? '').includes('\n');
            if (!inline && match) {
              return <CodeBlock language={match[1]} value={value} />;
            }
            return (
              <code
                className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[0.9em] dark:bg-stone-800"
                {...props}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {prepareChatMarkdown(file.content)}
      </ReactMarkdown>
    </div>
  ) : (
    <div className="-mx-1">
      <CodeBlock language={language} value={file.content} />
    </div>
  );
}

export function FilePreviewOverlay({
  file,
  onClose,
  onDownload,
  labels,
}: FilePreviewOverlayProps) {
  useEffect(() => {
    if (!file) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [file, onClose]);

  if (!file) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal
      aria-label={labels?.preview || 'File preview'}
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(92vh,1100px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-stone-700 dark:bg-stone-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-100 dark:bg-stone-800">
            <FileText className="h-4 w-4 text-stone-500" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
              {file.name}
            </div>
            <div className="truncate font-mono text-[11px] text-stone-400">
              {file.mimeType}
              {typeof file.size === 'number' && file.size > 0
                ? ` · ${file.size < 1024 ? `${file.size} B` : file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}`
                : ''}
            </div>
          </div>
          {onDownload && (
            <button
              type="button"
              title={labels?.download || 'Download'}
              onClick={() => onDownload(file)}
              className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            >
              <Download className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            aria-label={labels?.close || 'Close preview'}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <FilePreviewContent file={file} />
        </div>
      </div>
    </div>
  );
}
