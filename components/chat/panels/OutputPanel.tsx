'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, ChevronDown, FileText, Image as ImageIcon, Trash2 } from 'lucide-react';
import { FileEntryActions } from '@/components/files/FileEntryActions';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type GeneratedImageEntry = {
  messageId: string;
  imageIndex: number;
  url: string;
  prompt: string;
  model: string;
  timestamp: number;
};

export type GeneratedFileEntry = {
  messageId: string;
  fileIndex: number;
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  content?: string;
  createdAt: number;
};

function formatGeneratedAt(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type OutputPanelProps = {
  expanded: boolean;
  onToggleExpanded: () => void;
  groupsOpen: Record<string, boolean>;
  onToggleGroup: (key: 'images' | 'files') => void;
  images: GeneratedImageEntry[];
  files: GeneratedFileEntry[];
  onPreviewImage: (entry: GeneratedImageEntry) => void;
  onPreviewFile: (entry: GeneratedFileEntry) => void;
  onScrollToMessage: (messageId: string) => void;
  onDownloadImage: (entry: GeneratedImageEntry) => void;
  onRemoveImage: (entry: GeneratedImageEntry) => void;
  onDownloadFile: (entry: GeneratedFileEntry) => void;
  onRemoveFile: (entry: GeneratedFileEntry) => void;
};

export function OutputPanel({
  expanded,
  onToggleExpanded,
  groupsOpen,
  onToggleGroup,
  images,
  files,
  onPreviewImage,
  onPreviewFile,
  onScrollToMessage,
  onDownloadImage,
  onRemoveImage,
  onDownloadFile,
  onRemoveFile,
}: OutputPanelProps) {
  const { t } = useLocale();
  const count = images.length + files.length;

  return (
    <div className="rounded-xl border border-stone-200/80 dark:border-stone-800 overflow-hidden">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-stone-50 dark:hover:bg-stone-800/50"
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-500">
          <FileText className="h-3.5 w-3.5" />
          {t('generatedOutput')}
          {count > 0 && (
            <span className="rounded-md bg-stone-200/80 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              {count}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="max-h-72 space-y-3 overflow-y-auto border-t border-stone-200/70 px-3 py-2.5 dark:border-stone-800">
              {count === 0 ? (
                <div className="py-2 text-xs text-stone-400">{t('noGeneratedOutput')}</div>
              ) : (
                <>
                  {images.length > 0 && (
                    <div className="rounded-md bg-stone-50/70 dark:bg-stone-900/40">
                      <button
                        type="button"
                        onClick={() => onToggleGroup('images')}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-medium text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800/80"
                      >
                        <span className="flex items-center gap-1.5">
                          <ImageIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                          {t('outputImagesGroup')} · {images.length}
                        </span>
                        <ChevronDown
                          className={cn(
                            'h-3.5 w-3.5 text-stone-400 transition-transform',
                            groupsOpen.images && 'rotate-180',
                          )}
                        />
                      </button>
                      {groupsOpen.images && (
                        <div className="space-y-1.5 px-1.5 pb-1.5">
                          {images.map((entry) => (
                            <div
                              key={`${entry.messageId}-${entry.imageIndex}`}
                              className="flex items-stretch gap-2 rounded-lg border border-stone-200 bg-white/80 p-1.5 dark:border-stone-700 dark:bg-stone-950/40"
                            >
                              <button
                                type="button"
                                title={t('previewFile')}
                                onClick={() => onPreviewImage(entry)}
                                className="flex min-w-0 flex-1 items-stretch gap-2 rounded-md text-left hover:bg-stone-50 dark:hover:bg-stone-900/60"
                              >
                                <span className="h-11 w-11 shrink-0 overflow-hidden rounded-md bg-stone-200 dark:bg-stone-800">
                                  <img src={entry.url} alt="" className="h-full w-full object-cover" />
                                </span>
                                <span className="min-w-0 flex-1 py-0.5">
                                  <span className="block truncate font-mono text-[10px] leading-4 text-stone-400">
                                    {formatGeneratedAt(entry.timestamp)}
                                    <span className="mx-1 text-stone-600">·</span>
                                    {entry.model}
                                  </span>
                                  <span className="mt-0.5 block line-clamp-2 text-[12px] leading-4 text-stone-700 dark:text-stone-200">
                                    {entry.prompt}
                                  </span>
                                </span>
                              </button>
                              <div className="flex shrink-0 items-center self-center">
                                <FileEntryActions
                                  onDownload={() => onDownloadImage(entry)}
                                  downloadLabel={t('download')}
                                  moreLabel={t('moreActions')}
                                  items={[
                                    {
                                      label: t('viewInChat'),
                                      icon: <ArrowUpRight className="h-3.5 w-3.5" />,
                                      onSelect: () => onScrollToMessage(entry.messageId),
                                    },
                                    {
                                      label: t('delete'),
                                      icon: <Trash2 className="h-3.5 w-3.5" />,
                                      destructive: true,
                                      onSelect: () => onRemoveImage(entry),
                                    },
                                  ]}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {files.length > 0 && (
                    <div className="rounded-md bg-stone-50/70 dark:bg-stone-900/40">
                      <button
                        type="button"
                        onClick={() => onToggleGroup('files')}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-medium text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800/80"
                      >
                        <span className="flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
                          {t('outputFilesGroup')} · {files.length}
                        </span>
                        <ChevronDown
                          className={cn(
                            'h-3.5 w-3.5 text-stone-400 transition-transform',
                            groupsOpen.files && 'rotate-180',
                          )}
                        />
                      </button>
                      {groupsOpen.files && (
                        <div className="space-y-1.5 px-1.5 pb-1.5">
                          {files.map((entry) => (
                            <div
                              key={`${entry.messageId}-${entry.id}-${entry.fileIndex}`}
                              className="flex items-stretch gap-2 rounded-lg border border-stone-200 bg-white/80 p-1.5 dark:border-stone-700 dark:bg-stone-950/40"
                            >
                              <button
                                type="button"
                                title={t('previewFile')}
                                onClick={() => onPreviewFile(entry)}
                                className="flex min-w-0 flex-1 items-stretch gap-2 rounded-md text-left hover:bg-stone-50 dark:hover:bg-stone-900/60"
                              >
                                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-stone-200/80 dark:bg-stone-800">
                                  <FileText className="h-4 w-4 text-stone-500" />
                                </span>
                                <span className="min-w-0 flex-1 py-0.5">
                                  <span className="block truncate font-mono text-[10px] leading-4 text-stone-400">
                                    {formatGeneratedAt(entry.createdAt)}
                                    {entry.size > 0 && (
                                      <>
                                        <span className="mx-1 text-stone-600">·</span>
                                        {formatFileSize(entry.size)}
                                      </>
                                    )}
                                  </span>
                                  <span className="mt-0.5 block truncate text-[12px] leading-4 font-medium text-stone-700 dark:text-stone-200">
                                    {entry.name}
                                  </span>
                                </span>
                              </button>
                              <div className="flex shrink-0 items-center self-center">
                                <FileEntryActions
                                  onDownload={() => onDownloadFile(entry)}
                                  downloadLabel={t('download')}
                                  moreLabel={t('moreActions')}
                                  items={[
                                    {
                                      label: t('viewInChat'),
                                      icon: <ArrowUpRight className="h-3.5 w-3.5" />,
                                      onSelect: () => onScrollToMessage(entry.messageId),
                                    },
                                    {
                                      label: t('delete'),
                                      icon: <Trash2 className="h-3.5 w-3.5" />,
                                      destructive: true,
                                      onSelect: () => onRemoveFile(entry),
                                    },
                                  ]}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
