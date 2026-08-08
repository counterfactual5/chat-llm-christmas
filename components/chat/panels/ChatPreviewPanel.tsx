'use client';

import { useEffect, useState, type RefObject } from 'react';
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
  isEpubFile,
  isPdfFile,
  isPreviewableImageFile,
  isPreviewableTextFile,
  isSpreadsheetPreviewFile,
  needsExtractSidecarPreview,
} from '@/lib/files/preview';
import { fetchFileContentForPreview } from '@/lib/files/direct-content';
import { loadExtractSidecarPreviewContent } from '@/lib/files/extract-sidecar-preview';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { usePersistedPreviewScroll } from '@/hooks/chat/use-preview-scroll';
import type { GeneratedFileEntry } from './OutputPanel';
import { previewPanelWidth } from './panel-widths';
import { PreviewPanelShell } from './preview-panel-shell';

export type ChatPreviewPanelProps = {
  open: boolean;
  onClose: () => void;
  /** When Context is closed, Preview absorbs its width. */
  contextOpen?: boolean;
  /** Stay mounted while closed so loads / scroll survive soft-hide. */
  keepMounted?: boolean;
  /** Root for chat Quote selection inside the preview body. */
  quoteRootRef?: RefObject<HTMLDivElement | null>;
  file: GeneratedFileEntry | null;
  onExpandFullscreen: (payload: FilePreviewPayload) => void;
  onJumpToMessage: () => void;
  onDownload: () => void;
};

function fileSourceUrl(file: GeneratedFileEntry): string {
  const name = String(file.name || '').trim();
  const withFilename = (path: string) => {
    if (!name || !path.startsWith('/api/files/')) return path;
    const join = path.includes('?') ? '&' : '?';
    return `${path}${join}filename=${encodeURIComponent(name)}`;
  };
  const direct = String(file.url || '').trim();
  if (direct) return withFilename(direct);
  const id = String(file.id || '').trim();
  if (!id || id.startsWith('local:')) return '';
  return withFilename(`/api/files/${encodeURIComponent(id)}`);
}

export function ChatPreviewPanel({
  open,
  onClose,
  contextOpen = false,
  keepMounted = false,
  quoteRootRef,
  file,
  onExpandFullscreen,
  onJumpToMessage,
  onDownload,
}: ChatPreviewPanelProps) {
  const { t } = useLocale();
  const [fetchedContent, setFetchedContent] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState('');
  const [extracting, setExtracting] = useState(false);
  const width = previewPanelWidth(contextOpen);

  const previewable = Boolean(file && canPreviewGeneratedFile(file));
  const sourceUrl = file ? fileSourceUrl(file) : '';
  const hasInlineContent = typeof file?.content === 'string';
  const needsExtractWait = Boolean(file && needsExtractSidecarPreview(file));
  const needsTextFetch =
    Boolean(file) &&
    !hasInlineContent &&
    !needsExtractWait &&
    Boolean(sourceUrl) &&
    isPreviewableTextFile(file!) &&
    !isPdfFile(file!) &&
    !isEpubFile(file!) &&
    !isPreviewableImageFile(file!);
  const needsAsyncLoad = needsExtractWait || needsTextFetch;

  const isPdfOrEpubOrImage = Boolean(
    file &&
      (isEpubFile(file) || isPdfFile(file) || isPreviewableImageFile(file)) &&
      !file.content,
  );
  const isSheet = Boolean(file && isSpreadsheetPreviewFile(file));
  const scrollSurface = isSheet ? 'sheet' : 'file';
  const persistScroll = Boolean(file && !isPdfOrEpubOrImage);
  const persistRef = usePersistedPreviewScroll(
    scrollSurface,
    file?.id,
    persistScroll,
  );

  useEffect(() => {
    // Do not abort when the panel is soft-hidden (`open` false) — only when
    // there is no file / no async work to do.
    if (!file || !needsAsyncLoad) {
      setFetchedContent(null);
      setFetchError('');
      setExtracting(false);
      return;
    }

    let cancelled = false;
    const ac = new AbortController();
    setFetchedContent(null);
    setFetchError('');
    setExtracting(needsExtractWait);

    void (async () => {
      try {
        if (needsExtractWait) {
          const fileId = String(file.id || '').trim();
          const state = await loadExtractSidecarPreviewContent({
            fileId,
            signal: ac.signal,
            failedMessage: t('extractPreviewFailed'),
          });
          if (cancelled || state.status === 'aborted') return;
          if (state.status === 'failed') {
            setFetchError(state.error);
            setExtracting(false);
            return;
          }
          setFetchedContent(state.content);
          setExtracting(false);
          return;
        }

        const { buf } = await fetchFileContentForPreview(sourceUrl, {
          signal: ac.signal,
        });
        const text = new TextDecoder('utf-8').decode(buf);
        if (!cancelled) setFetchedContent(text);
      } catch (cause) {
        if (cancelled || ac.signal.aborted) return;
        setFetchError(cause instanceof Error ? cause.message : t('requestFailed'));
        setExtracting(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [file?.id, file?.url, file?.size, file?.contentRev, needsAsyncLoad, needsExtractWait, sourceUrl, t]);

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
    if (sourceUrl && (isPdfFile(file) || isEpubFile(file) || isPreviewableImageFile(file))) {
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        url: sourceUrl,
        size: file.size,
      };
    }
    if (needsAsyncLoad && typeof fetchedContent === 'string') {
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

  const setBodyRef = (el: HTMLDivElement | null) => {
    (persistRef as { current: HTMLDivElement | null }).current = el;
    if (quoteRootRef) {
      (quoteRootRef as { current: HTMLDivElement | null }).current = el;
    }
  };

  return (
    <PreviewPanelShell open={open} keepMounted={keepMounted} width={width}>
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

          <div
            ref={setBodyRef}
            className={cn(
              'relative min-h-0 min-w-0 flex-1 overscroll-contain',
              isPdfOrEpubOrImage
                ? 'overflow-hidden'
                : isSheet
                  ? 'overflow-auto'
                  : 'overflow-x-hidden overflow-y-auto',
            )}
          >
            {!file ? (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-xs text-stone-400">
                <FileText className="h-8 w-8 opacity-40" />
                <span>{t('previewPanelEmpty')}</span>
              </div>
            ) : resolved ? (
              <div
                className={cn(
                  'min-h-0 min-w-0 max-w-full',
                  isEpubFile(file) || isPdfFile(file) || isPreviewableImageFile(file)
                    ? 'absolute inset-0 flex min-h-0 flex-col p-0'
                    : 'px-4 py-4',
                )}
              >
                <FilePreviewContent file={resolved} />
              </div>
            ) : needsAsyncLoad && !fetchError ? (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-xs text-stone-400">
                <Loader2 className="h-8 w-8 animate-spin opacity-60" />
                <span>{extracting ? t('extractingPreview') : t('loading')}</span>
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
    </PreviewPanelShell>
  );
}
