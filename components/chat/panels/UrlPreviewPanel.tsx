'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpRight,
  FileText,
  Globe,
  Loader2,
  PanelRightClose,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AnswerMarkdown } from '@/components/chat/message/AnswerMarkdown';
import {
  isLikelyAuthGatedPreviewUrl,
  isLikelyPaperPreviewUrl,
  normalizePreviewHttpUrl,
  previewNavigationTargetEquals,
} from '@/lib/files/url-preview';
import {
  EMBED_PROBE_TIMING,
  decideDegradeAction,
  probeEmbedOutcome,
} from '@/lib/files/url-preview-embed';
import { cleanUrlExtractText } from '@/lib/files/url-extract-clean';
import { requestPaperDownload } from '@/lib/chat/turn/literature-search';
import type { GeneratedFileEntry } from '@/components/chat/panels/OutputPanel';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { previewPanelWidth } from './panel-widths';

export type UrlPreviewPanelProps = {
  open: boolean;
  onClose: () => void;
  contextOpen?: boolean;
  quoteRootRef?: RefObject<HTMLDivElement | null>;
  url: string;
  title?: string;
  /** Prefer extract body over iframe (caller override / auth degrade). */
  forceExtract?: boolean;
  /** Navigate the preview to another http(s) URL (address-bar submit). */
  onNavigateUrl?: (url: string) => void;
  /** After OA paper PDF downloads into Files, switch to file preview. */
  onOpenDownloadedFile?: (entry: GeneratedFileEntry) => void;
};

type ExtractState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'done';
      title?: string;
      content: string;
      truncated?: boolean;
      nextOffset?: number | null;
    }
  | { status: 'error'; message: string }
  | { status: 'no-oa'; message: string };

type PreviewMode = 'iframe' | 'extract' | 'auth';

/** Align with chat-api HARD_MAX_CONTENT_CHARS / proxy clamp. */
const PREVIEW_MAX_CHARS = 200_000;

const TRUNCATED_MARKER_RE = /\n\n…\[truncated\]\s*$/;

function initialPreviewMode(url: string, forceExtract: boolean): PreviewMode {
  if (isLikelyAuthGatedPreviewUrl(url) && !forceExtract) return 'auth';
  // Default Text: extract works for Quote and bypasses XFO/CSP frame blocks.
  return 'extract';
}

async function fetchWebReadExtract(
  url: string,
  signal?: AbortSignal,
  opts?: { startIndex?: number },
): Promise<{
  title?: string;
  content: string;
  quality?: string;
  truncated?: boolean;
  nextOffset?: number | null;
}> {
  const body: Record<string, unknown> = { url, maxChars: PREVIEW_MAX_CHARS };
  if (opts?.startIndex != null && opts.startIndex > 0) {
    body.startIndex = Math.floor(opts.startIndex);
  }
  const res = await fetch('/api/web-read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    title?: string | null;
    content?: string;
    quality?: string;
    truncated?: boolean;
    nextOffset?: number | null;
  };
  if (!res.ok) {
    throw new Error(String(data.error || data.message || `HTTP ${res.status}`));
  }
  const content = String(data.content || '').trim();
  if (!content) {
    throw new Error(String(data.error || data.message || 'Empty page'));
  }
  return {
    title: data.title ? String(data.title) : undefined,
    content,
    quality: data.quality ? String(data.quality) : undefined,
    truncated: Boolean(data.truncated),
    nextOffset:
      data.nextOffset == null || !Number.isFinite(Number(data.nextOffset))
        ? null
        : Number(data.nextOffset),
  };
}

function fileEntryFromPaperDownload(dl: {
  fileId: string;
  filename: string;
  title: string;
  bytes: number;
}): GeneratedFileEntry {
  return {
    messageId: 'url-preview-paper',
    fileIndex: 0,
    id: dl.fileId,
    name: dl.filename || `${dl.title || 'paper'}.pdf`,
    mimeType: 'application/pdf',
    size: dl.bytes || 0,
    url: `/api/files/${encodeURIComponent(dl.fileId)}`,
    createdAt: Date.now(),
  };
}

export function UrlPreviewPanel({
  open,
  onClose,
  contextOpen = false,
  quoteRootRef,
  url,
  title: initialTitle,
  forceExtract = false,
  onNavigateUrl,
  onOpenDownloadedFile,
}: UrlPreviewPanelProps) {
  const { t } = useLocale();
  const width = previewPanelWidth(contextOpen);
  const authGated = isLikelyAuthGatedPreviewUrl(url);
  const [mode, setMode] = useState<PreviewMode>(() =>
    initialPreviewMode(url, forceExtract),
  );
  const [extract, setExtract] = useState<ExtractState>({ status: 'idle' });
  const [displayTitle, setDisplayTitle] = useState(initialTitle || '');
  const [draftUrl, setDraftUrl] = useState(url);
  const [urlError, setUrlError] = useState('');
  const prefetchRef = useRef<ExtractState>({ status: 'idle' });
  // Blocked-embed degrade state (KTD1/KTD2). prefetchReady mirrors the
  // prefetchRef status as React state so the degrade effect can react.
  const [embedLikelyBlocked, setEmbedLikelyBlocked] = useState(false);
  const [prefetchReady, setPrefetchReady] = useState<ExtractState>({
    status: 'idle',
  });
  const [settleFired, setSettleFired] = useState(false);
  const [embedNotice, setEmbedNotice] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const reProbeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;
  const degradeHandledRef = useRef(false);
  const [extractRetryNonce, setExtractRetryNonce] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  // Parent often passes inline callbacks (e.g. openFilePreview). Keep them off
  // effect deps — otherwise every ChatContainer re-render (session switch,
  // streaming, …) aborts an in-flight extract and the Preview looks "cut off".
  const onOpenDownloadedFileRef = useRef(onOpenDownloadedFile);
  onOpenDownloadedFileRef.current = onOpenDownloadedFile;
  const tRef = useRef(t);
  tRef.current = t;

  const clearReProbeTimer = () => {
    if (reProbeTimerRef.current != null) {
      clearTimeout(reProbeTimerRef.current);
      reProbeTimerRef.current = null;
    }
  };

  // Hard-reset extract/embed state only when the page target changes — not
  // when `initialTitle` alone churns (that remounts Text and flashes images).
  useEffect(() => {
    clearReProbeTimer();
    setMode(initialPreviewMode(url, forceExtract));
    setExtract({ status: 'idle' });
    setDisplayTitle(initialTitle || '');
    setDraftUrl(url);
    setUrlError('');
    prefetchRef.current = { status: 'idle' };
    setEmbedLikelyBlocked(false);
    setPrefetchReady({ status: 'idle' });
    setSettleFired(false);
    setEmbedNotice(false);
    setLoadingMore(false);
    degradeHandledRef.current = false;
    setExtractRetryNonce(0);
    return () => clearReProbeTimer();
  }, [url, forceExtract]);

  useEffect(() => {
    if (initialTitle) setDisplayTitle(initialTitle);
  }, [initialTitle]);

  const switchMode = (next: PreviewMode) => {
    // Manual mode switch cancels any pending degrade decision (no loops).
    degradeHandledRef.current = true;
    setEmbedNotice(false);
    setMode(next);
  };

  const retryExtract = () => {
    degradeHandledRef.current = false;
    setEmbedLikelyBlocked(false);
    setSettleFired(false);
    setPrefetchReady({ status: 'idle' });
    prefetchRef.current = { status: 'idle' };
    setExtract({ status: 'idle' });
    setExtractRetryNonce((n) => n + 1);
  };

  const submitAddress = (e: FormEvent) => {
    e.preventDefault();
    if (!onNavigateUrl) return;
    const normalized = normalizePreviewHttpUrl(draftUrl);
    if (!normalized) {
      setUrlError(t('urlPreviewInvalidUrl'));
      return;
    }
    setUrlError('');
    if (normalized === url) return;
    onNavigateUrl(normalized);
  };

  // Prefetch extract in parallel while iframe tries to load (skip auth-gated hosts).
  // Used when the user switches to Text — do not auto-switch mode on timer/Quote alone.
  useEffect(() => {
    if (!open || !url || mode !== 'iframe') return;
    const ac = new AbortController();
    prefetchRef.current = { status: 'loading' };
    setPrefetchReady({ status: 'loading' });
    void fetchWebReadExtract(url, ac.signal)
      .then((result) => {
        prefetchRef.current = {
          status: 'done',
          title: result.title,
          content: result.content,
          truncated: result.truncated,
          nextOffset: result.nextOffset,
        };
        setPrefetchReady({
          status: 'done',
          title: result.title,
          content: result.content,
          truncated: result.truncated,
          nextOffset: result.nextOffset,
        });
        if (result.title) setDisplayTitle((prev) => prev || result.title || '');
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        prefetchRef.current = {
          status: 'error',
          message:
            err instanceof Error ? err.message : tRef.current('requestFailed'),
        };
        setPrefetchReady(prefetchRef.current);
      });
    return () => ac.abort();
  }, [open, url, mode, extractRetryNonce]);

  // Load extract when in extract mode. Paper-like URLs try OA PDF download first.
  // Abort only when the page target / mode / open flag changes — not when the
  // parent re-renders with a new callback identity (conversation switch).
  useEffect(() => {
    if (!open || !url || mode !== 'extract') return;
    const applyDone = (result: {
      title?: string;
      content: string;
      truncated?: boolean;
      nextOffset?: number | null;
    }) => {
      const next: ExtractState = {
        status: 'done',
        title: result.title,
        content: result.content,
        truncated: result.truncated,
        nextOffset: result.nextOffset,
      };
      prefetchRef.current = next;
      setPrefetchReady(next);
      setExtract(next);
      if (result.title) setDisplayTitle((prev) => prev || result.title || '');
    };
    const applyThinOrError = (message: string) => {
      const next: ExtractState = { status: 'no-oa', message };
      prefetchRef.current = next;
      setPrefetchReady(next);
      setExtract(next);
    };
    const cached = prefetchRef.current;
    if (cached.status === 'done') {
      setExtract(cached);
      if (cached.title) setDisplayTitle((prev) => prev || cached.title || '');
      return;
    }
    if (cached.status === 'no-oa') {
      setExtract(cached);
      return;
    }
    const ac = new AbortController();
    setExtract({ status: 'loading' });

    void (async () => {
      try {
        if (isLikelyPaperPreviewUrl(url) && onOpenDownloadedFileRef.current) {
          const dl = await requestPaperDownload(url);
          if (ac.signal.aborted) return;
          if (dl.ok) {
            onOpenDownloadedFileRef.current(fileEntryFromPaperDownload(dl));
            return;
          }
          // Fall through to HTML extract; thin shells become CTA.
        }

        const result = await fetchWebReadExtract(url, ac.signal);
        if (ac.signal.aborted) return;
        if (
          isLikelyPaperPreviewUrl(url) &&
          (result.quality === 'thin' || !result.content.trim())
        ) {
          applyThinOrError(tRef.current('urlPreviewNoOpenAccessBody'));
          return;
        }
        applyDone(result);
      } catch (err) {
        if (ac.signal.aborted) return;
        if (isLikelyPaperPreviewUrl(url)) {
          applyThinOrError(
            err instanceof Error
              ? err.message
              : tRef.current('urlPreviewNoOpenAccessBody'),
          );
          return;
        }
        const next: ExtractState = {
          status: 'error',
          message:
            err instanceof Error ? err.message : tRef.current('requestFailed'),
        };
        prefetchRef.current = next;
        setPrefetchReady(next);
        setExtract(next);
      }
    })();

    return () => ac.abort();
  }, [open, url, mode, extractRetryNonce]);

  // Blocked-embed degrade (KTD1/KTD2): heuristic probe + settle timer.
  // Auto-switches to Text only when the prefetched extract is already in
  // hand; otherwise replaces the dead iframe with an actionable fallback.
  useEffect(() => {
    if (!open || mode !== 'iframe' || !embedLikelyBlocked) return;
    if (degradeHandledRef.current) return;
    const action = decideDegradeAction({
      embedLikelyBlocked,
      prefetch: prefetchReady.status,
      settleFired,
    });
    if (action === 'auto-extract') {
      degradeHandledRef.current = true;
      setExtract(prefetchReady);
      if (prefetchReady.status === 'done' && prefetchReady.title) {
        setDisplayTitle((prev) => prev || prefetchReady.title || '');
      }
      setMode('extract');
      setEmbedNotice(true);
      return;
    }
    if (action === 'wait') {
      const timer = setTimeout(
        () => setSettleFired(true),
        EMBED_PROBE_TIMING.settleMs,
      );
      return () => clearTimeout(timer);
    }
  }, [open, mode, embedLikelyBlocked, prefetchReady, settleFired]);

  const degradeAction =
    mode === 'iframe' && embedLikelyBlocked && !degradeHandledRef.current
      ? decideDegradeAction({
          embedLikelyBlocked,
          prefetch: prefetchReady.status,
          settleFired,
        })
      : 'wait';
  const showEmbedFallback = degradeAction === 'fallback';
  const showEmbedPending =
    degradeAction === 'wait' && mode === 'iframe' && embedLikelyBlocked;

  const handleIframeLoad = () => {
    if (!iframeRef.current) return;
    const first = probeEmbedOutcome(iframeRef.current);
    if (first === 'ready') {
      // Late-successful load flips a stale blocked flag back off.
      setEmbedLikelyBlocked(false);
      return;
    }
    if (first === 'unknown') return;
    setEmbedLikelyBlocked(true);
    // Error documents settle async — re-probe once shortly after.
    clearReProbeTimer();
    const generationUrl = url;
    reProbeTimerRef.current = setTimeout(() => {
      reProbeTimerRef.current = null;
      if (generationUrl !== urlRef.current) return;
      if (!iframeRef.current) return;
      const second = probeEmbedOutcome(iframeRef.current);
      if (second === 'ready') {
        setEmbedLikelyBlocked(false);
      } else if (second === 'likely-blocked') {
        setEmbedLikelyBlocked(true);
      }
    }, EMBED_PROBE_TIMING.reProbeMs);
  };

  const headerTitle = displayTitle || t('urlPreviewPanel');
  const openExternally = () => window.open(url, '_blank', 'noopener,noreferrer');
  const cleanedExtractContent = useMemo(
    () =>
      extract.status === 'done'
        ? cleanUrlExtractText(extract.content, { title: extract.title })
        : '',
    [extract],
  );

  const loadMoreExtract = async () => {
    if (extract.status !== 'done' || !extract.truncated || extract.nextOffset == null) {
      return;
    }
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await fetchWebReadExtract(url, undefined, {
        startIndex: extract.nextOffset,
      });
      const prior = extract.content.replace(TRUNCATED_MARKER_RE, '').trimEnd();
      const chunk = more.content.replace(TRUNCATED_MARKER_RE, '').trim();
      const merged = chunk ? `${prior}\n\n${chunk}` : prior;
      const next: ExtractState = {
        status: 'done',
        title: extract.title || more.title,
        content: more.truncated ? `${merged}\n\n…[truncated]` : merged,
        truncated: Boolean(more.truncated),
        nextOffset: more.nextOffset,
      };
      prefetchRef.current = next;
      setPrefetchReady(next);
      setExtract(next);
    } catch (err) {
      // Keep existing body; surface a soft failure via title bar is overkill —
      // leave truncated state so the user can retry Load more.
      console.warn(
        '[UrlPreview] load more failed',
        err instanceof Error ? err.message : err,
      );
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ width: { duration: 0.2, ease: 'easeInOut' } }}
          className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-l border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
        >
          <div className="relative flex h-14 shrink-0 items-center justify-center gap-2 border-b border-stone-200/50 px-4 dark:border-stone-800/50">
            <span className="pointer-events-none absolute inset-x-40 truncate text-center text-sm font-semibold text-stone-700 dark:text-stone-300">
              {headerTitle}
            </span>
            <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
              {mode === 'iframe' || (mode === 'extract' && !authGated) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  title={
                    mode === 'iframe'
                      ? t('urlPreviewShowExtract')
                      : t('urlPreviewShowEmbed')
                  }
                  onClick={() =>
                    switchMode(mode === 'iframe' ? 'extract' : 'iframe')
                  }
                  className="mr-0.5 h-7 px-2 text-xs text-stone-500"
                >
                  {mode === 'iframe'
                    ? t('urlPreviewShowExtract')
                    : t('urlPreviewShowEmbed')}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                title={authGated ? t('urlPreviewOpenWithLogin') : t('openInNewTab')}
                onClick={openExternally}
                className="h-8 w-8 text-stone-500"
              >
                <ArrowUpRight className="h-4 w-4" />
              </Button>
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

          <form
            onSubmit={submitAddress}
            className="shrink-0 border-b border-stone-100 px-3 py-1.5 dark:border-stone-800"
          >
            <input
              type="url"
              value={draftUrl}
              readOnly={!onNavigateUrl}
              onChange={(e) => {
                setDraftUrl(e.target.value);
                if (urlError) setUrlError('');
              }}
              onBlur={() => {
                // Keep draft aligned with committed URL when user abandons edits.
                if (!onNavigateUrl) return;
                if (normalizePreviewHttpUrl(draftUrl) === url || draftUrl.trim() === url) {
                  setDraftUrl(url);
                  setUrlError('');
                }
              }}
              aria-label={t('urlPreviewAddressLabel')}
              placeholder={t('urlPreviewPastePlaceholder')}
              className={cn(
                'w-full rounded-md bg-transparent px-1 py-0.5 text-[11px] text-stone-500 outline-none',
                'placeholder:text-stone-300 focus:bg-stone-50 focus:text-stone-700 focus:ring-1 focus:ring-stone-200',
                'dark:text-stone-400 dark:placeholder:text-stone-600 dark:focus:bg-stone-950 dark:focus:text-stone-200 dark:focus:ring-stone-700',
                onNavigateUrl ? 'cursor-text' : 'cursor-default',
              )}
            />
            {urlError ? (
              <p className="px-1 pt-1 text-[10px] text-red-500">{urlError}</p>
            ) : null}
          </form>

          <div
            ref={quoteRootRef}
            data-quote-url={mode === 'extract' ? url : undefined}
            data-quote-title={
              mode === 'extract' ? displayTitle || undefined : undefined
            }
            className="flex min-h-0 min-w-0 flex-1 flex-col overscroll-contain"
          >
            {mode === 'iframe' ? (
              <div className="shrink-0 border-b border-amber-200/80 bg-amber-50/95 px-3 py-1.5 text-[11px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/90 dark:text-amber-100">
                <span>{t('urlPreviewQuoteNeedsExtract')} </span>
                <button
                  type="button"
                  className="font-medium underline underline-offset-2"
                  onClick={() => switchMode('extract')}
                >
                  {t('urlPreviewShowExtract')}
                </button>
              </div>
            ) : null}
            {mode === 'extract' && embedNotice ? (
              <div className="flex shrink-0 items-center gap-2 border-b border-amber-200/80 bg-amber-50/95 px-3 py-1.5 text-[11px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/90 dark:text-amber-100">
                <span className="min-w-0 flex-1 truncate">
                  {t('urlPreviewEmbedBlockedSwitched')}
                </span>
                <button
                  type="button"
                  aria-label={t('dismiss')}
                  onClick={() => setEmbedNotice(false)}
                  className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
            <div
              className={cn(
                'relative min-h-0 min-w-0 flex-1',
                mode === 'iframe' ? 'overflow-hidden' : 'overflow-x-hidden overflow-y-auto',
              )}
            >
              {mode === 'auth' ? (
                <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
                  <Globe className="h-8 w-8 text-stone-300 opacity-60 dark:text-stone-600" />
                  <div className="max-w-sm space-y-2">
                    <p className="text-sm font-medium text-stone-700 dark:text-stone-200">
                      {t('urlPreviewAuthGatedTitle')}
                    </p>
                    <p className="text-xs leading-relaxed text-stone-400 dark:text-stone-500">
                      {t('urlPreviewAuthGatedBody')}
                    </p>
                  </div>
                  <Button type="button" className="rounded-lg" onClick={openExternally}>
                    <ArrowUpRight className="mr-1.5 h-4 w-4" />
                    {t('urlPreviewOpenWithLogin')}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setMode('extract')}
                    className="text-xs text-stone-500 underline-offset-2 hover:underline dark:text-stone-400"
                  >
                    {t('urlPreviewTryExtractAnyway')}
                  </button>
                </div>
              ) : mode === 'iframe' ? (
                <div className="absolute inset-0">
                  {showEmbedFallback ? (
                    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-16 text-center">
                      <Globe className="h-8 w-8 text-stone-300 opacity-60 dark:text-stone-600" />
                      <div className="max-w-sm space-y-2">
                        <p className="text-sm font-medium text-stone-700 dark:text-stone-200">
                          {t('urlPreviewEmbedBlockedFallbackTitle')}
                        </p>
                        <p className="text-xs leading-relaxed text-stone-400 dark:text-stone-500">
                          {t('urlPreviewEmbedBlockedBody')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          className="rounded-lg"
                          onClick={openExternally}
                        >
                          <ArrowUpRight className="mr-1.5 h-4 w-4" />
                          {t('openInNewTab')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-lg"
                          onClick={retryExtract}
                        >
                          {t('urlPreviewRetryExtract')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <iframe
                        key={url}
                        ref={iframeRef}
                        title={headerTitle}
                        src={url}
                        referrerPolicy="no-referrer"
                        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                        onLoad={handleIframeLoad}
                        className="absolute inset-0 h-full w-full border-0 bg-white dark:bg-stone-950"
                      />
                      {showEmbedPending ? (
                        <div className="pointer-events-none absolute left-1/2 top-2 z-10 max-w-[90%] -translate-x-1/2 truncate rounded-full border border-amber-200/80 bg-amber-50/95 px-3 py-1 text-[11px] text-amber-900 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/90 dark:text-amber-100">
                          {t('urlPreviewEmbedMaybeBlocked')}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              ) : extract.status === 'loading' || extract.status === 'idle' ? (
                <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-xs text-stone-400">
                  <Loader2 className="h-8 w-8 animate-spin opacity-60" />
                  <span>
                    {isLikelyPaperPreviewUrl(url)
                      ? t('urlPreviewResolvingPaper')
                      : t('urlPreviewExtracting')}
                  </span>
                </div>
              ) : extract.status === 'no-oa' ? (
                <div className="flex flex-col items-center gap-3 px-6 py-16 text-center text-xs text-stone-500 dark:text-stone-400">
                  <FileText className="h-8 w-8 opacity-40" />
                  <p className="text-sm font-medium text-stone-700 dark:text-stone-200">
                    {t('urlPreviewNoOpenAccessTitle')}
                  </p>
                  <p className="max-w-sm leading-5">
                    {extract.message || t('urlPreviewNoOpenAccessBody')}
                  </p>
                  <button
                    type="button"
                    onClick={openExternally}
                    className="rounded-lg border border-stone-200 px-3 py-1.5 text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                  >
                    {t('openInNewTab')}
                  </button>
                </div>
              ) : extract.status === 'error' ? (
                <div className="flex flex-col items-center gap-3 px-6 py-16 text-center text-xs text-stone-400">
                  <Globe className="h-8 w-8 opacity-40" />
                  <span>{extract.message || t('urlPreviewExtractFailed')}</span>
                  <button
                    type="button"
                    onClick={openExternally}
                    className="rounded-lg border border-stone-200 px-3 py-1.5 text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                  >
                    {authGated ? t('urlPreviewOpenWithLogin') : t('openInNewTab')}
                  </button>
                </div>
              ) : (
                <div className="px-4 py-4">
                  {extract.title ? (
                    <h2 className="mb-3 text-base font-semibold text-stone-900 dark:text-stone-100">
                      {extract.title}
                    </h2>
                  ) : null}
                  <AnswerMarkdown
                    text={cleanedExtractContent}
                    streaming={false}
                    previewBaseUrl={onNavigateUrl ? url : undefined}
                    onPreviewLink={
                      onNavigateUrl
                        ? (next) => {
                            if (previewNavigationTargetEquals(next, url)) return;
                            onNavigateUrl(next);
                          }
                        : undefined
                    }
                  />
                  {extract.status === 'done' &&
                  extract.truncated &&
                  extract.nextOffset != null ? (
                    <div className="mt-4 flex flex-col items-center gap-2 border-t border-stone-200/80 pt-4 dark:border-stone-800">
                      <p className="text-[11px] text-stone-400 dark:text-stone-500">
                        {t('urlPreviewTruncated')}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-lg"
                        disabled={loadingMore}
                        onClick={() => void loadMoreExtract()}
                      >
                        {loadingMore ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : null}
                        {t('urlPreviewLoadMore')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Empty Preview chrome with a paste-URL form (no active file/url target). */
export function UrlPreviewEmptyPaste({
  open,
  onClose,
  contextOpen = false,
  onOpenUrl,
}: {
  open: boolean;
  onClose: () => void;
  contextOpen?: boolean;
  onOpenUrl: (url: string) => void;
}) {
  const { t } = useLocale();
  const width = previewPanelWidth(contextOpen);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const normalized = normalizePreviewHttpUrl(draft);
    if (!normalized) {
      setError(t('urlPreviewInvalidUrl'));
      return;
    }
    setError('');
    onOpenUrl(normalized);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ width: { duration: 0.2, ease: 'easeInOut' } }}
          className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-l border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
        >
          <div className="relative flex h-14 shrink-0 items-center justify-center border-b border-stone-200/50 px-4 dark:border-stone-800/50">
            <span className="pointer-events-none absolute inset-x-12 truncate text-center text-sm font-semibold text-stone-700 dark:text-stone-300">
              {t('previewPanel')}
            </span>
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
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
          <div className="flex flex-1 flex-col items-center gap-4 px-6 py-12">
            <FileText className="h-8 w-8 text-stone-300 opacity-60 dark:text-stone-600" />
            <p className="text-center text-xs text-stone-400">{t('previewPanelEmpty')}</p>
            <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-2">
              <label className="text-[11px] font-medium text-stone-500">
                {t('urlPreviewPasteLabel')}
              </label>
              <input
                type="url"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (error) setError('');
                }}
                placeholder={t('urlPreviewPastePlaceholder')}
                className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none ring-orange-400/40 placeholder:text-stone-400 focus:ring-2 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
              />
              {error ? <p className="text-[11px] text-red-500">{error}</p> : null}
              <Button type="submit" className="mt-1 w-full rounded-lg">
                {t('urlPreviewOpen')}
              </Button>
            </form>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
