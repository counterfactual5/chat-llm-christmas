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
import { normalizePreviewHttpUrl } from '@/lib/files/url-preview';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { previewPanelWidth } from './panel-widths';

const IFRAME_FALLBACK_MS = 5000;

export type UrlPreviewPanelProps = {
  open: boolean;
  onClose: () => void;
  contextOpen?: boolean;
  quoteRootRef?: RefObject<HTMLDivElement | null>;
  url: string;
  title?: string;
  /** Prefer extract body over iframe (user toggle or auto fallback). */
  forceExtract?: boolean;
};

type ExtractState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; title?: string; content: string }
  | { status: 'error'; message: string };

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
}: UrlPreviewPanelProps) {
  const { t } = useLocale();
  const width = previewPanelWidth(contextOpen);
  const [mode, setMode] = useState<'iframe' | 'extract'>(
    forceExtract ? 'extract' : 'iframe',
  );
  const [extract, setExtract] = useState<ExtractState>({ status: 'idle' });
  const [displayTitle, setDisplayTitle] = useState(initialTitle || '');
  const iframeLoadedRef = useRef(false);
  const prefetchRef = useRef<ExtractState>({ status: 'idle' });

  useEffect(() => {
    setMode(forceExtract ? 'extract' : 'iframe');
    setExtract({ status: 'idle' });
    setDisplayTitle(initialTitle || '');
    iframeLoadedRef.current = false;
    prefetchRef.current = { status: 'idle' };
  }, [url, initialTitle, forceExtract]);

  // Prefetch extract in parallel while iframe tries to load (needs login).
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

  // Auto-fallback: if iframe never reports load, switch to extract.
  useEffect(() => {
    if (!open || !url || mode !== 'iframe') return;
    const timer = window.setTimeout(() => {
      if (iframeLoadedRef.current) return;
      setMode('extract');
    }, IFRAME_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [open, url, mode]);

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
              {mode === 'iframe' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  title={t('urlPreviewShowExtract')}
                  onClick={() => setMode('extract')}
                  className="h-8 px-2 text-xs text-stone-500"
                >
                  {t('urlPreviewShowExtract')}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  title={t('urlPreviewShowEmbed')}
                  onClick={() => {
                    iframeLoadedRef.current = false;
                    setMode('iframe');
                  }}
                  className="h-8 px-2 text-xs text-stone-500"
                >
                  {t('urlPreviewShowEmbed')}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                title={t('openInNewTab')}
                onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
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

          <p className="shrink-0 truncate border-b border-stone-100 px-4 py-1.5 text-[11px] text-stone-400 dark:border-stone-800 dark:text-stone-500">
            {url}
          </p>

          <div
            ref={quoteRootRef}
            className={cn(
              'relative min-h-0 min-w-0 flex-1 overscroll-contain',
              mode === 'iframe' ? 'overflow-hidden' : 'overflow-x-hidden overflow-y-auto',
            )}
          >
            {mode === 'iframe' ? (
              <iframe
                key={url}
                title={headerTitle}
                src={url}
                referrerPolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                className="absolute inset-0 h-full w-full border-0 bg-white dark:bg-stone-950"
                onLoad={() => {
                  iframeLoadedRef.current = true;
                }}
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
                  onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                  className="rounded-lg border border-stone-200 px-3 py-1.5 text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                >
                  {t('openInNewTab')}
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
