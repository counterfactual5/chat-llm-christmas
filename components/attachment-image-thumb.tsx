'use client';

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IngestedAttachment } from '@/lib/file-ingest';

export function attachmentImageSrc(a: Pick<IngestedAttachment, 'previewUrl' | 'dataUrl'>): string | undefined {
  return a.previewUrl || a.dataUrl;
}

export function isImageAttachment(a: IngestedAttachment): boolean {
  if (a.type.startsWith('image/')) return true;
  const src = attachmentImageSrc(a);
  return Boolean(src && (src.startsWith('data:image') || a.previewUrl || a.fileId));
}

type AttachmentImageThumbProps = {
  attachment: IngestedAttachment;
  onRemove?: () => void;
  onPreview?: (src: string) => void;
  className?: string;
  /** Fixed square thumb in composer */
  variant?: 'composer' | 'free';
};

export function AttachmentImageThumb({
  attachment: a,
  onRemove,
  onPreview,
  className,
  variant = 'composer',
}: AttachmentImageThumbProps) {
  const src = attachmentImageSrc(a);
  const [loadError, setLoadError] = useState(false);

  if (!src) return null;

  const uploading = Boolean(a.uploading);
  const failed = Boolean(a.uploadError) || loadError;
  const canPreview = !uploading && !failed;

  return (
    <div className={cn('group/thumb relative shrink-0', className)}>
      <button
        type="button"
        disabled={!canPreview}
        onClick={() => canPreview && onPreview?.(src)}
        title={a.name}
        className={cn(
          'relative block overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/60',
          variant === 'composer' && 'h-[4.5rem] w-[4.5rem] sm:h-20 sm:w-20',
          canPreview && 'cursor-zoom-in',
          !canPreview && 'cursor-default',
        )}
      >
        <img
          src={src}
          alt={a.name}
          className={cn(
            variant === 'composer'
              ? 'h-full w-full object-cover'
              : 'max-h-32 max-w-[min(100%,14rem)] object-contain',
            'transition-[filter,opacity] duration-200',
            uploading && 'grayscale opacity-50',
            failed && !uploading && 'grayscale opacity-70',
          )}
          onError={() => setLoadError(true)}
        />
        {failed && (
          <div
            className="pointer-events-none absolute inset-0 rounded-lg bg-red-500/20 ring-2 ring-red-500/70"
            aria-hidden
          />
        )}
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-stone-300/40 dark:bg-stone-700/50">
            <Loader2 className="h-6 w-6 animate-spin text-stone-600 dark:text-stone-300" />
          </div>
        )}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -right-1.5 -top-1.5 z-10 rounded-full border border-stone-200 bg-white p-0.5 text-stone-500 shadow-sm opacity-0 transition-opacity group-hover/thumb:opacity-100 hover:text-red-500 dark:border-stone-600 dark:bg-stone-800 [@media(hover:none)]:opacity-100"
          title="Remove"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

type ImagePreviewOverlayProps = {
  src: string | null;
  onClose: () => void;
};

export function ImagePreviewOverlay({ src, onClose }: ImagePreviewOverlayProps) {
  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
      aria-label="Image preview"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        aria-label="Close preview"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt=""
        className="max-h-[min(92vh,1200px)] max-w-full object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
