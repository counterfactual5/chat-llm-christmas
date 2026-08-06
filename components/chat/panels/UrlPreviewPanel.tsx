'use client';

import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpRight,
  FileText,
  Globe,
  Loader2,
  PanelRightClose,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AnswerMarkdown } from '@/components/chat/message/AnswerMarkdown';
import {
  isLikelyAuthGatedPreviewUrl,
  normalizePreviewHttpUrl,
} from '@/lib/files/url-preview';
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
};

type ExtractState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; title?: string; content: string }
  | { status: 'error'; message: string };

type PreviewMode = 'iframe' | 'extract' | 'auth';

function initialPreviewMode(url: string, forceExtract: boolean): PreviewMode {
  if (forceExtract) return 'extract';
  if (isLikelyAuthGatedPreviewUrl(url)) return 'auth';
  return 'iframe';
}

async function fetchWebReadExtract(
  url: string,
  signal?: AbortSignal,
): Promise<{ title?: string; content: string }> {
  const res = await fetch('/api/web-read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, maxChars: 80_000 }),
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    title?: string | null;
    content?: string;
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

  useEffect(() => {
    setMode(initialPreviewMode(url, forceExtract));
    setExtract({ status: 'idle' });
    setDisplayTitle(initialTitle || '');
    setDraftUrl(url);
    setUrlError('');
    prefetchRef.current = { status: 'idle' };
  }, [url, initialTitle, forceExtract]);

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
    void fetchWebReadExtract(url, ac.signal)
      .then((result) => {
        prefetchRef.current = {
          status: 'done',
          title: result.title,
          content: result.content,
        };
        if (result.title) setDisplayTitle((prev) => prev || result.title || '');
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        prefetchRef.current = {
          status: 'error',
          message: err instanceof Error ? err.message : t('requestFailed'),
        };
      });
    return () => ac.abort();
  }, [open, url, mode, t]);

  // Load extract when in extract mode.
  useEffect(() => {
    if (!open || !url || mode !== 'extract') return;
    const cached = prefetchRef.current;
    if (cached.status === 'done') {
      setExtract(cached);
      if (cached.title) setDisplayTitle((prev) => prev || cached.title || '');
      return;
    }
    const ac = new AbortController();
    setExtract({ status: 'loading' });
    void fetchWebReadExtract(url, ac.signal)
      .then((result) => {
        setExtract({
          status: 'done',
          title: result.title,
          content: result.content,
        });
        if (result.title) setDisplayTitle((prev) => prev || result.title || '');
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setExtract({
          status: 'error',
          message: err instanceof Error ? err.message : t('requestFailed'),
        });
      });
    return () => ac.abort();
  }, [open, url, mode, t]);

  const headerTitle = displayTitle || t('urlPreviewPanel');
  const openExternally = () => window.open(url, '_blank', 'noopener,noreferrer');

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
                <div
                  className="mr-0.5 flex items-center rounded-md border border-stone-200 p-0.5 dark:border-stone-700"
                  role="group"
                  aria-label={t('urlPreviewPanel')}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    title={t('urlPreviewShowEmbed')}
                    aria-pressed={mode === 'iframe'}
                    onClick={() => setMode('iframe')}
                    className={cn(
                      'h-7 px-2 text-xs',
                      mode === 'iframe'
                        ? 'bg-stone-100 font-medium text-stone-800 dark:bg-stone-800 dark:text-stone-100'
                        : 'text-stone-500',
                    )}
                  >
                    {t('urlPreviewShowEmbed')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    title={t('urlPreviewShowExtract')}
                    aria-pressed={mode === 'extract'}
                    onClick={() => setMode('extract')}
                    className={cn(
                      'h-7 px-2 text-xs',
                      mode === 'extract'
                        ? 'bg-stone-100 font-medium text-stone-800 dark:bg-stone-800 dark:text-stone-100'
                        : 'text-stone-500',
                    )}
                  >
                    {t('urlPreviewShowExtract')}
                  </Button>
                </div>
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
                  onClick={() => setMode('extract')}
                >
                  {t('urlPreviewShowExtract')}
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
                <iframe
                  key={url}
                  title={headerTitle}
                  src={url}
                  referrerPolicy="no-referrer"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                  className="absolute inset-0 h-full w-full border-0 bg-white dark:bg-stone-950"
                />
              ) : extract.status === 'loading' || extract.status === 'idle' ? (
                <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-xs text-stone-400">
                  <Loader2 className="h-8 w-8 animate-spin opacity-60" />
                  <span>{t('urlPreviewExtracting')}</span>
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
                  <AnswerMarkdown text={extract.content} streaming={false} />
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
