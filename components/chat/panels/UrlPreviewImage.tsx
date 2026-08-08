'use client';

/**
 * Single-image renderer for the URL Preview panel.
 *
 * States:
 *   loading    — remote http(s) image still downloading
 *   loaded     — <img> displayed (+ optional manual Describe)
 *   error      — remote fetch failed OR src skipped; show placeholder card
 *   describing — user clicked "Describe image", API in flight
 *   described  — vision text shown under the image (or in place of placeholder)
 *
 * Never auto-OCR. Never throw, never bubble — failure leaves retry UI.
 */

import { useState } from 'react';
import { Image as ImageIcon, Loader2, Languages } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import {
  classifyPreviewImageSrc,
  truncateImageAlt,
  truncateImageDescription,
} from '@/lib/files/url-preview-image';
import { cn } from '@/lib/utils';

type ImageState =
  | { kind: 'loading' }
  | { kind: 'loaded' }
  | { kind: 'error' }
  | { kind: 'describing'; from: 'loaded' | 'error' }
  | { kind: 'described'; text: string; keepImage: boolean };

function DescribeButton({
  busy,
  label,
  busyLabel,
  onClick,
}: {
  busy: boolean;
  label: string;
  busyLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
        busy
          ? 'cursor-wait border-stone-300 text-stone-400 dark:border-stone-700 dark:text-stone-500'
          : 'border-orange-300 text-orange-700 hover:border-orange-400 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-300 dark:hover:bg-orange-950/40',
      )}
    >
      {busy ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          {busyLabel}
        </>
      ) : (
        <>
          <Languages className="h-3 w-3" />
          {label}
        </>
      )}
    </button>
  );
}

export function UrlPreviewImage({
  src,
  alt,
  baseUrl,
}: {
  src?: string;
  alt?: string;
  baseUrl?: string;
}) {
  const { t } = useLocale();
  const initial: ImageState =
    classifyPreviewImageSrc(src, baseUrl).kind === 'skip'
      ? { kind: 'error' }
      : { kind: 'loading' };
  const [state, setState] = useState<ImageState>(initial);

  const classified = classifyPreviewImageSrc(src, baseUrl);
  const displayAlt = truncateImageAlt(alt);

  const describeImage = async (from: 'loaded' | 'error') => {
    if (classified.kind !== 'remote') return;
    setState({ kind: 'describing', from });
    try {
      const res = await fetch('/api/image-understand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: classified.src }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        text?: string;
        error?: string;
      };
      if (res.ok && data.ok && typeof data.text === 'string' && data.text.trim()) {
        setState({
          kind: 'described',
          text: truncateImageDescription(data.text),
          keepImage: from === 'loaded',
        });
        return;
      }
      setState(from === 'loaded' ? { kind: 'loaded' } : { kind: 'error' });
    } catch {
      setState(from === 'loaded' ? { kind: 'loaded' } : { kind: 'error' });
    }
  };

  if (state.kind === 'described' && !state.keepImage) {
    return (
      <figure className="my-3 rounded-lg border border-stone-200 bg-stone-50/60 p-3 dark:border-stone-800 dark:bg-stone-900/40">
        <figcaption className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
          <Languages className="h-3 w-3" />
          {t('urlPreviewImageDescriptionLabel')}
        </figcaption>
        <div className="whitespace-pre-wrap text-[13px] leading-5 text-stone-700 dark:text-stone-300">
          {state.text}
        </div>
      </figure>
    );
  }

  if (state.kind === 'error' || (state.kind === 'describing' && state.from === 'error')) {
    const busy = state.kind === 'describing';
    return (
      <figure className="my-3 rounded-lg border border-dashed border-stone-300 bg-stone-50/60 p-3 dark:border-stone-700 dark:bg-stone-900/40">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-[13px] text-stone-600 dark:text-stone-400">
            <ImageIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              {displayAlt || t('urlPreviewImagePlaceholderAlt')}
            </span>
          </div>
          {classified.kind === 'remote' ? (
            <DescribeButton
              busy={busy}
              label={t('urlPreviewImageUnderstand')}
              busyLabel={t('urlPreviewImageUnderstanding')}
              onClick={() => void describeImage('error')}
            />
          ) : null}
        </div>
      </figure>
    );
  }

  // loading / loaded / describing-from-loaded / described-with-image
  const remoteSrc = classified.kind === 'remote' ? classified.src : '';
  const busy = state.kind === 'describing';
  const showChrome = state.kind === 'loaded' || busy || state.kind === 'described';

  return (
    <figure className="my-3 overflow-hidden rounded-lg border border-stone-200 bg-stone-50/40 dark:border-stone-800 dark:bg-stone-900/40">
      {state.kind === 'loading' ? (
        <div className="flex min-h-[80px] items-center justify-center gap-2 p-4 text-[12px] text-stone-500 dark:text-stone-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('urlPreviewImageLoading')}
        </div>
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- remote URLs from arbitrary extracts */}
      <img
        src={remoteSrc}
        alt={displayAlt}
        loading="lazy"
        onLoad={() => {
          setState((prev) =>
            prev.kind === 'loading' || prev.kind === 'loaded' ? { kind: 'loaded' } : prev,
          );
        }}
        onError={() => setState({ kind: 'error' })}
        className={cn(
          'max-h-80 w-full object-contain',
          state.kind === 'loading' && 'hidden',
        )}
      />
      {showChrome && classified.kind === 'remote' ? (
        <div className="flex items-center justify-end gap-2 border-t border-stone-200/80 px-2 py-1.5 dark:border-stone-800">
          {state.kind === 'described' ? null : (
            <DescribeButton
              busy={busy}
              label={t('urlPreviewImageUnderstand')}
              busyLabel={t('urlPreviewImageUnderstanding')}
              onClick={() => void describeImage('loaded')}
            />
          )}
        </div>
      ) : null}
      {state.kind === 'described' && state.keepImage ? (
        <div className="border-t border-stone-200/80 px-3 py-2 dark:border-stone-800">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
            <Languages className="h-3 w-3" />
            {t('urlPreviewImageDescriptionLabel')}
          </div>
          <div className="whitespace-pre-wrap text-[13px] leading-5 text-stone-700 dark:text-stone-300">
            {state.text}
          </div>
        </div>
      ) : null}
    </figure>
  );
}
