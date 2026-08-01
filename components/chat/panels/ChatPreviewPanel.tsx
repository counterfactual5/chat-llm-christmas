'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpRight,
  Download,
  FileText,
  Maximize2,
  PanelRightClose,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FilePreviewContent } from '@/components/files/FilePreviewOverlay';
import { useLocale } from '@/lib/i18n';
import type { GeneratedFileEntry } from './OutputPanel';

export type ChatPreviewPanelProps = {
  open: boolean;
  onClose: () => void;
  file: GeneratedFileEntry | null;
  onExpandFullscreen: () => void;
  onJumpToMessage: () => void;
  onDownload: () => void;
};

export function ChatPreviewPanel({
  open,
  onClose,
  file,
  onExpandFullscreen,
  onJumpToMessage,
  onDownload,
}: ChatPreviewPanelProps) {
  const { t } = useLocale();
  const canRender =
    file && typeof file.content === 'string' && file.content.length >= 0
      ? {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          content: file.content || '',
          size: file.size,
        }
      : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 460, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ width: { duration: 0.2, ease: 'easeInOut' } }}
          className="h-full shrink-0 border-l border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 flex flex-col overflow-hidden"
        >
          <div className="flex h-14 items-center justify-between gap-2 px-4 border-b border-stone-200/50 dark:border-stone-800/50 shrink-0">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-700 dark:text-stone-300">
              {file?.name || t('previewPanel')}
            </span>
            <div className="flex shrink-0 items-center gap-0.5">
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
                  {canRender && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t('expandFullscreen')}
                      onClick={onExpandFullscreen}
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

          <ScrollArea className="flex-1">
            {!file ? (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-xs text-stone-400">
                <FileText className="h-8 w-8 opacity-40" />
                <span>{t('previewPanelEmpty')}</span>
              </div>
            ) : canRender ? (
              <div className="px-4 py-4">
                <FilePreviewContent file={canRender} />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center text-xs text-stone-400">
                <FileText className="h-8 w-8 opacity-40" />
                <span>{t('noPreviewAvailable')}</span>
                <button
                  type="button"
                  onClick={onDownload}
                  className="rounded-lg border border-stone-200 px-3 py-1.5 text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                >
                  {t('download')}
                </button>
              </div>
            )}
          </ScrollArea>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
