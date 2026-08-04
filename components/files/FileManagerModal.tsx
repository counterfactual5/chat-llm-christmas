'use client';

import { useEffect, useMemo, useState } from 'react';
import { FileText, Image as ImageIcon, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/components/chat/panels/OutputPanel';
import { ImagePreviewOverlay } from '@/components/files/AttachmentImageThumb';
import { FileEntryActions } from '@/components/files/FileEntryActions';
import {
  FilePreviewOverlay,
  type FilePreviewPayload,
} from '@/components/files/FilePreviewOverlay';
import { isEpubFile, isPdfFile, isPreviewableImageFile, isPreviewableTextFile } from '@/lib/files/preview';
import { useLocale } from '@/lib/i18n';

export type AccountFile = {
  id: string;
  filename?: string;
  bytes?: number;
  purpose?: string;
  mime?: string;
  created_at?: number;
  createdAt?: number;
};

type FileManagerModalProps = {
  open: boolean;
  onClose: () => void;
};

function fileCreatedAt(file: AccountFile): number {
  const raw = Number(file.created_at || file.createdAt || 0);
  // The portal returns Unix seconds; accept milliseconds too for compatibility.
  return raw > 0 && raw < 10_000_000_000 ? raw * 1_000 : raw;
}

function shortFileId(file: AccountFile): string {
  return String(file.id || '').replace(/^file_/, '').slice(0, 8);
}

function isImageFile(file: AccountFile): boolean {
  return isPreviewableImageFile({ name: file.filename, mime: file.mime });
}

function isTextFile(file: AccountFile): boolean {
  return isPreviewableTextFile({ name: file.filename, mime: file.mime });
}

function formatDate(timestamp: number): string {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export function FileManagerModal({ open, onClose }: FileManagerModalProps) {
  const { t } = useLocale();
  const [files, setFiles] = useState<AccountFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<AccountFile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [textPreview, setTextPreview] = useState<FilePreviewPayload | null>(null);

  const loadFiles = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/files?limit=100', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(data?.error || `Failed to load files (${response.status})`));
      setFiles(Array.isArray(data?.data) ? data.data : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void loadFiles();
  }, [open]);

  const totalBytes = useMemo(
    () => files.reduce((total, file) => total + Math.max(0, Number(file.bytes || 0)), 0),
    [files],
  );

  const deleteFile = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setError('');
    try {
      const response = await fetch(`/api/files/${encodeURIComponent(pendingDelete.id)}`, {
        method: 'DELETE',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 404) {
        throw new Error(String(data?.error || `Failed to delete file (${response.status})`));
      }
      setFiles((previous) => previous.filter((file) => file.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to delete file');
    } finally {
      setDeleting(false);
    }
  };

  const previewFile = async (file: AccountFile) => {
    const url = `/api/files/${encodeURIComponent(file.id)}`;
    if (isImageFile(file)) {
      setImagePreview(url);
      return;
    }
    const asBinaryBook =
      isEpubFile({ name: file.filename, mime: file.mime }) ||
      isPdfFile({ name: file.filename, mime: file.mime });
    if (asBinaryBook) {
      setTextPreview({
        id: file.id,
        name: file.filename || file.id,
        mimeType:
          file.mime ||
          (isEpubFile({ name: file.filename, mime: file.mime })
            ? 'application/epub+zip'
            : 'application/pdf'),
        url,
        size: Number(file.bytes || 0),
      });
      return;
    }
    if (!isTextFile(file)) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    setError('');
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to load preview (${response.status})`);
      const content = await response.text();
      setTextPreview({
        id: file.id,
        name: file.filename || file.id,
        mimeType: file.mime || 'text/plain',
        content,
        size: Number(file.bytes || 0),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load preview');
    }
  };

  if (!open) return null;

  const previewOpen = Boolean(imagePreview || textPreview);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={() => {
        // Keep Files open while a nested preview is showing; closing preview
        // must not dismiss the manager (overlay clicks bubble here otherwise).
        if (deleting || previewOpen) return;
        onClose();
      }}
    >
      <section
        className="flex max-h-[min(42rem,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-stone-800 dark:bg-stone-900"
        onClick={(event) => event.stopPropagation()}
        aria-label="File manager"
      >
        <header className="flex items-center justify-between border-b border-stone-200 px-5 py-4 dark:border-stone-800">
          <div>
            <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">Files</h2>
            <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
              {files.length} file{files.length === 1 ? '' : 's'} · {formatFileSize(totalBytes)}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void loadFiles()}
              disabled={loading || deleting}
              title="Refresh files"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={deleting}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {error && <p className="mx-5 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-stone-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading files…
            </div>
          ) : files.length === 0 ? (
            <div className="py-12 text-center text-sm text-stone-500">No stored files.</div>
          ) : (
            <ul className="space-y-1">
              {files.map((file) => (
                <li key={file.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-stone-50 dark:hover:bg-stone-800/60">
                  {isImageFile(file) ? (
                    <ImageIcon className="h-5 w-5 shrink-0 text-stone-400" />
                  ) : (
                    <FileText className="h-5 w-5 shrink-0 text-stone-400" />
                  )}
                  <button
                    type="button"
                    onClick={() => void previewFile(file)}
                    className="min-w-0 flex-1 text-left"
                    title="Preview"
                  >
                    <p className="truncate text-sm font-medium text-stone-800 hover:underline dark:text-stone-200">
                      {file.filename || file.id}
                    </p>
                    <p className="truncate text-xs text-stone-500 dark:text-stone-400">
                      {formatFileSize(Number(file.bytes || 0)) || 'Unknown size'} · {formatDate(fileCreatedAt(file))}
                      {file.purpose ? ` · ${file.purpose}` : ''} · ID {shortFileId(file)}
                    </p>
                  </button>
                  <FileEntryActions
                    size="md"
                    onDownload={() =>
                      window.open(`/api/files/${encodeURIComponent(file.id)}`, '_blank', 'noopener,noreferrer')
                    }
                    downloadLabel={t('download')}
                    moreLabel={t('moreActions')}
                    items={[
                      {
                        label: t('delete'),
                        icon: <Trash2 className="h-3.5 w-3.5" />,
                        destructive: true,
                        onSelect: () => setPendingDelete(file),
                      },
                    ]}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <ImagePreviewOverlay src={imagePreview} onClose={() => setImagePreview(null)} />
      <FilePreviewOverlay
        file={textPreview}
        onClose={() => setTextPreview(null)}
        onDownload={(file) => window.open(`/api/files/${encodeURIComponent(file.id)}`, '_blank', 'noopener,noreferrer')}
      />

      {pendingDelete && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <section className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-stone-900">
            <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">Delete file?</h3>
            <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">
              “{pendingDelete.filename || pendingDelete.id}” will be permanently deleted from your account. Messages that reference it may no longer be able to load it.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={deleting} onClick={() => setPendingDelete(null)}>Cancel</Button>
              <Button type="button" disabled={deleting} onClick={() => void deleteFile()} className="bg-red-500 text-white hover:bg-red-600">
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
