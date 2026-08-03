'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpRight,
  Download,
  FileText,
  Loader2,
  Maximize2,
  PanelRightClose,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  FilePreviewContent,
  type FilePreviewPayload,
} from '@/components/files/FilePreviewOverlay';
import {
  canPreviewGeneratedFile,
  isPdfFile,
  isPreviewableImageFile,
  isPreviewableTextFile,
} from '@/lib/files/preview';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { GeneratedFileEntry } from './OutputPanel';

export type ChatPreviewPanelProps = {
  open: boolean;
  onClose: () => void;
  file: GeneratedFileEntry | null;
  onExpandFullscreen: (payload: FilePreviewPayload) => void;
  onJumpToMessage: () => void;
  onDownload: () => void;
};

function fileSourceUrl(file: GeneratedFileEntry): string {
  const direct = String(file.url || '').trim();
  if (direct) return direct;
  const id = String(file.id || '').trim();
  if (!id || id.startsWith('local:')) return '';
  return `/api/files/${encodeURIComponent(id)}`;
}

export function ChatPreviewPanel({
  open,
  onClose,
  file,
  onExpandFullscreen,
  onJumpToMessage,
  onDownload,
}: ChatPreviewPanelProps) {
  const { t } = useLocale();
  const [fetchedContent, setFetchedContent] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState('');

  const previewable = Boolean(file && canPreviewGeneratedFile(file));
  const sourceUrl = file ? fileSourceUrl(file) : '';
  const hasInlineContent = typeof file?.content === 'string';
  const needsTextFetch =
    Boolean(file) &&
    !hasInlineContent &&
    Boolean(sourceUrl) &&
    isPreviewableTextFile(file!) &&
    !isPdfFile(file!) &&
    !isPreviewableImageFile(file!);

  useEffect(() => {
    if (!open || !file || !needsTextFetch) {
      setFetchedContent(null);
      setFetchError('');
      return;
    }

    let cancelled = false;
    setFetchedContent(null);
    setFetchError('');

    void (async () => {
      try {
        const response = await fetch(sourceUrl);
        if (!response.ok) throw new Error(`Failed to load preview (${response.status})`);
        const text = await response.text();
        if (!cancelled) setFetchedContent(text);
      } catch (cause) {
        if (!cancelled) {
          setFetchError(cause instanceof Error ? cause.message : t('requestFailed'));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, file?.id, file?.url, needsTextFetch, sourceUrl, t]);

  const resolved: FilePreviewPayload | null = (() => {
    if (!file || !previewable) return null;
    if (hasInlineContent) {
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        content: file.content || '',
        url: sourceUrl || undefined,
        size: file.size,
      };
    }
    if (sourceUrl && (isPdfFile(file) || isPreviewableImageFile(file))) {
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        url: sourceUrl,
        size: file.size,
      };
    }
    if (needsTextFetch && typeof fetchedContent === 'string') {
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        content: fetchedContent,
        url: sourceUrl || undefined,
        size: file.size,
      };
    }
    return null;
  })();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 460, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ width: { duration: 0.2, ease: 'easeInOut' } }}
          className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-l border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
        >
          <div className="relative flex h-14 shrink-0 items-center justify-center gap-2 border-b border-stone-200/50 px-4 dark:border-stone-800/50">
            <span
              className={cn(
                'pointer-events-none absolute truncate text-center text-sm font-semibold text-stone-700 dark:text-stone-300',
                file ? 'inset-x-36' : 'inset-x-12',
              )}
            >
              {file?.name || t('previewPanel')}
            </span>
            <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
              {file && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('viewInChat')}
                    onClick={onJumpToMessage}
                    className="h-8 w-8 text-stone-500"
                  >
                    <ArrowUpRight className="h-4 w-4" />
                  </Button>
                  {resolved && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t('expandFullscreen')}
                      onClick={() => onExpandFullscreen(resolved)}
                      className="h-8 w-8 text-stone-500"
                    >
                      <Maximize2 className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('download')}
                    onClick={onDownload}
                    className="h-8 w-8 text-stone-500"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-8 w-8 text-stone-500"
                aria-label={t('closePreview')}
              >
                <PanelRightClose className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
            {!file ? (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-xs text-stone-400">
                <FileText className="h-8 w-8 opacity-40" />
                <span>{t('previewPanelEmpty')}</span>
              </div>
            ) : resolved ? (
              <div className="min-w-0 max-w-full px-4 py-4">
                <FilePreviewContent file={resolved} />
              </div>
            ) : needsTextFetch && !fetchError ? (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-xs text-stone-400">
                <Loader2 className="h-8 w-8 animate-spin opacity-60" />
                <span>{t('loading')}</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center text-xs text-stone-400">
                <FileText className="h-8 w-8 opacity-40" />
                <span>{fetchError || t('noPreviewAvailable')}</span>
                <button
                  type="button"
                  onClick={onDownload}
                  className="rounded-lg border border-stone-200 px-3 py-1.5 text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                >
                  {t('download')}
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
