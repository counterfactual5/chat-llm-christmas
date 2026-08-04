'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, Loader2, X } from 'lucide-react';
import { AnswerMarkdown } from '@/components/chat/message/AnswerMarkdown';
import { EpubReader } from '@/components/files/EpubReader';
import { CodeBlock } from '@/components/markdown/code/code-block';
import {
  isEpubFile,
  isPdfFile,
  isPreviewableImageFile,
  isSpreadsheetPreviewFile,
} from '@/lib/files/preview';
import {
  parseSpreadsheetPreviewText,
  type ParsedSpreadsheetSection,
} from '@/lib/files/spreadsheet';
import { isEpubBytes, isPdfBytes } from '@/lib/files/serve-headers';
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

function describeNonPdf(buf: ArrayBuffer, contentType: string): string {
  const ct = String(contentType || '').split(';')[0].trim() || 'unknown type';
  if (isEpubBytes(buf) || ct === 'application/epub+zip') {
    return 'EPUB_BYTES';
  }
  const head = new Uint8Array(buf.slice(0, 8));
  const hex = [...head].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  return `Response is not a PDF (${ct || 'no content-type'}; first bytes: ${hex || 'empty'})`;
}

/**
 * Chrome’s PDF plugin inside an iframe is unreliable when the URL path is a
 * bare hash id and Content-Type is application/octet-stream. Fetch → blob with
 * an explicit application/pdf type (cookies still sent same-origin).
 *
 * LibGen downloads sometimes store EPUB bytes as *.pdf — hand off to EpubReader.
 */
function PdfPreviewFrame({
  url,
  title,
  fileId,
}: {
  url: string;
  title: string;
  fileId: string;
}) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  const [asEpub, setAsEpub] = useState(false);

  useEffect(() => {
    let objectUrl = '';
    let cancelled = false;
    setSrc('');
    setError('');
    setAsEpub(false);

    void (async () => {
      try {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          const hint = detail.trim().slice(0, 120);
          throw new Error(
            hint
              ? `Failed to load PDF (${response.status}): ${hint}`
              : `Failed to load PDF (${response.status})`,
          );
        }
        const buf = await response.arrayBuffer();
        if (isEpubBytes(buf)) {
          if (!cancelled) setAsEpub(true);
          return;
        }
        if (!isPdfBytes(buf)) {
          throw new Error(
            describeNonPdf(buf, response.headers.get('content-type') || ''),
          );
        }
        objectUrl = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = '';
          return;
        }
        setSrc(`${objectUrl}#toolbar=0`);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Failed to load PDF');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (asEpub) {
    return <EpubReader fileId={fileId || url} url={url} title={title} />;
  }

  if (error) {
    return (
      <div className="flex min-h-[24rem] flex-col items-center justify-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-4 text-center text-xs text-stone-500 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400">
        <FileText className="h-8 w-8 opacity-40" />
        <span className="max-w-sm leading-relaxed">{error}</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-stone-200 px-3 py-1.5 text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
        >
          Download / open in new tab
        </a>
      </div>
    );
  }

  if (!src) {
    return (
      <div className="flex min-h-[24rem] items-center justify-center gap-2 rounded-lg border border-stone-200 bg-stone-50 text-xs text-stone-400 dark:border-stone-800 dark:bg-stone-900">
        <Loader2 className="h-5 w-5 animate-spin opacity-60" />
        <span>Loading PDF…</span>
      </div>
    );
  }

  return (
    <iframe
      title={title}
      src={src}
      className="h-[min(80vh,900px)] w-full min-h-[24rem] rounded-lg border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900"
    />
  );
}

function SpreadsheetTablePreview({ sections }: { sections: ParsedSpreadsheetSection[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {sections.map((section) => {
        const colCount = Math.max(1, ...section.rows.map((r) => r.length));
        const [header, ...body] = section.rows;
        const hasHeader = Boolean(header && header.some((c) => c.trim()));
        return (
          <div key={section.name} className="min-w-0">
            {sections.length > 1 || section.name !== 'Sheet1' ? (
              <div className="mb-2 text-xs font-medium text-stone-500 dark:text-stone-400">
                {section.name}
              </div>
            ) : null}
            <div className="min-w-0 overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-800">
              <table className="w-full min-w-[240px] border-collapse text-left text-xs">
                {hasHeader ? (
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900/60">
                      {Array.from({ length: colCount }, (_, i) => (
                        <th
                          key={i}
                          className="px-2.5 py-1.5 font-semibold text-stone-700 dark:text-stone-200"
                        >
                          {header?.[i] ?? ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                ) : null}
                <tbody>
                  {(hasHeader ? body : section.rows).map((row, ri) => (
                    <tr
                      key={ri}
                      className="border-b border-stone-100 last:border-0 dark:border-stone-800/80"
                    >
                      {Array.from({ length: colCount }, (_, ci) => (
                        <td
                          key={ci}
                          className="max-w-[220px] truncate px-2.5 py-1.5 text-stone-600 dark:text-stone-300"
                          title={row[ci] || ''}
                        >
                          {row[ci] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Pure content renderer (markdown / code / PDF / EPUB / image / table) — overlay + side panel. */
export function FilePreviewContent({ file }: { file: FilePreviewPayload }) {
  const url = String(file.url || '').trim();
  if (!file.content && url && isEpubFile(file)) {
    return <EpubReader fileId={file.id || url} url={url} title={file.name} />;
  }
  if (!file.content && url && isPdfFile(file)) {
    return <PdfPreviewFrame url={url} title={file.name} fileId={file.id || url} />;
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
