'use client';

import { useEffect, useMemo } from 'react';
import { Download, FileText, X } from 'lucide-react';
import { AnswerMarkdown } from '@/components/chat/message/AnswerMarkdown';
import { CodeBlock } from '@/components/markdown/code/code-block';
import { cn } from '@/lib/utils';

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

/**
 * Prefer the chat AnswerMarkdown path (ASCII reflow, GFM, math) for prose-like
 * generated files — not only `.md`. Plain `.txt` / text/plain often carries the
 * same diagrams models put in chat answers.
 */
export function prefersAnswerMarkdownPreview(
  file: Pick<FilePreviewPayload, 'name' | 'mimeType'>,
): boolean {
  if (isMarkdownPreview(file)) return true;
  const mime = String(file.mimeType || '').toLowerCase();
  if (mime === 'text/plain' || mime.startsWith('text/plain;')) return true;
  const ext = fileExt(file.name);
  return ext === 'txt' || ext === 'text';
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
  const richText = useMemo(() => prefersAnswerMarkdownPreview(file), [file]);
  const language = useMemo(() => languageFromFilename(file.name), [file]);

  return richText ? (
    <div className={cn('mx-auto w-full min-w-0 max-w-3xl')}>
      {/* Same Markdown path as chat answers — ASCII reflow, fenced text blocks, tables. */}
      <AnswerMarkdown text={file.content} streaming={false} />
    </div>
  ) : (
    <div className="min-w-0 max-w-full">
      <CodeBlock language={language} value={file.content} wrap />
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
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="flex max-h-[min(92vh,1100px)] min-h-0 w-full min-w-0 max-w-4xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-stone-700 dark:bg-stone-950"
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
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            aria-label={labels?.close || 'Close preview'}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 sm:px-6">
          <FilePreviewContent file={file} />
        </div>
      </div>
    </div>
  );
}
