'use client';

import { useEffect } from 'react';
import { Download, FileText, X } from 'lucide-react';
import { AnswerMarkdown } from '@/components/chat/message/AnswerMarkdown';
import { EpubReader } from '@/components/files/EpubReader';
import { PdfReader } from '@/components/files/PdfReader';
import { SpreadsheetTable } from '@/components/files/SpreadsheetTable';
import { CodeBlock } from '@/components/markdown/code/code-block';
import {
  isEpubFile,
  isPdfFile,
  isPreviewableImageFile,
  isSpreadsheetPreviewFile,
  formatPreviewTypeLabel,
} from '@/lib/files/preview';
import { parseSpreadsheetPreviewText } from '@/lib/files/spreadsheet-text';
import { fileExt, languageFromFilename } from '@/lib/files/text-types';
import { cn } from '@/lib/utils';

export type FilePreviewPayload = {
  id: string;
  name: string;
  mimeType: string;
  /** Inline UTF-8 text (create_file / text extracts). */
  content?: string;
  /** Gateway /api/files/... URL for PDF / EPUB / image binary preview. */
  url?: string;
  size?: number;
};

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

export { languageFromFilename };

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

function SpreadsheetTablePreview({
  sections,
}: {
  sections: ReturnType<typeof parseSpreadsheetPreviewText>;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {sections.map((section) => {
        const [header, ...body] = section.rows;
        const hasHeader = Boolean(
          section.rows.length > 1 && header && header.some((c) => c.trim()),
        );
        return (
          <SpreadsheetTable
            key={section.name}
            sheetName={
              sections.length > 1 || section.name !== 'Sheet1' ? section.name : undefined
            }
            headers={hasHeader ? header : undefined}
            rows={hasHeader ? body : section.rows}
          />
        );
      })}
    </div>
  );
}

/** Pure content renderer (markdown / code / PDF / EPUB / image / table) — overlay + side panel. */
export function FilePreviewContent({ file }: { file: FilePreviewPayload }) {
  const url = String(file.url || '').trim();
  if (!file.content && url && isEpubFile(file)) {
    return (
      <EpubReader
        fileId={file.id || url}
        url={url}
        title={file.name}
        className="h-full min-h-[20rem] rounded-none border-0"
      />
    );
  }
  if (!file.content && url && isPdfFile(file)) {
    return (
      <div className="h-full min-h-0 w-full">
        <PdfReader url={url} title={file.name} fileId={file.id || url} />
      </div>
    );
  }
  if (!file.content && url && isPreviewableImageFile(file)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={file.name}
        className="mx-auto max-h-[min(80vh,900px)] max-w-full object-contain"
      />
    );
  }

  const text = typeof file.content === 'string' ? file.content : '';
  if (text && isSpreadsheetPreviewFile(file)) {
    const sections = parseSpreadsheetPreviewText(text);
    if (sections.length) {
      return <SpreadsheetTablePreview sections={sections} />;
    }
  }

  const richText = prefersAnswerMarkdownPreview(file);
  const language = languageFromFilename(file.name);

  return richText ? (
    <div className={cn('mx-auto w-full min-w-0 max-w-3xl')}>
      <AnswerMarkdown text={text} streaming={false} />
    </div>
  ) : (
    <div className="min-w-0 max-w-full">
      <CodeBlock language={language} value={text} wrap />
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

  const binaryFill =
    !file.content &&
    (isEpubFile(file) || isPdfFile(file) || isPreviewableImageFile(file));

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
        className={cn(
          'flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-stone-700 dark:bg-stone-950',
          // Explicit height so flex-1 PDF/EPUB body can fill; max-w wider for books.
          binaryFill
            ? 'h-[min(92vh,1100px)] max-w-[min(96vw,72rem)]'
            : 'max-h-[min(92vh,1100px)] max-w-4xl',
        )}
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
            <div className="truncate text-[11px] text-stone-400">
              {formatPreviewTypeLabel(file)}
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

        <div
          className={cn(
            'relative min-h-0 min-w-0 flex-1',
            binaryFill
              ? 'overflow-hidden p-0'
              : isSpreadsheetPreviewFile(file)
                ? 'overflow-auto px-4 py-4 sm:px-6'
                : 'overflow-x-hidden overflow-y-auto px-4 py-4 sm:px-6',
          )}
        >
          {binaryFill ? (
            <div className="absolute inset-0 min-h-0 min-w-0">
              <FilePreviewContent file={file} />
            </div>
          ) : (
            <FilePreviewContent file={file} />
          )}
        </div>
      </div>
    </div>
  );
}
