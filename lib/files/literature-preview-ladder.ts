/**
 * Shared paper/book Preview ladder: resolve → probe content → ephemeral |
 * download-only CTA | fall through to HTML extract.
 * UI panels and chat-container should call these helpers — do not fork paths.
 */

import {
  ephemeralPreviewEntry,
  friendlyLiteraturePreviewMessage,
  identifierFromContentUrl,
  identifierFromEphemeralPreviewId,
  kindFromEphemeralPreviewId,
  literatureContentUrl,
  type EphemeralPreviewEntry,
  type EphemeralPreviewKind,
} from '@/lib/files/ephemeral-preview';
import {
  isJunkBookExtractHost,
  isLikelyBookPreviewUrl,
  isLikelyPaperPreviewUrl,
} from '@/lib/files/url-preview';

export type LiteratureResolveResult =
  | { ok: true; title: string; filename?: string }
  | { ok: false; error: string; code?: string };

export type LiteratureDownloadResult =
  | {
      ok: true;
      fileId: string;
      filename: string;
      title: string;
      bytes: number;
    }
  | { ok: false; error: string };

export type LiteratureLadderOutcome =
  | { outcome: 'ephemeral'; entry: EphemeralPreviewEntry }
  | { outcome: 'download_only'; message: string }
  | { outcome: 'cta'; message: string }
  | { outcome: 'fallthrough' }
  | { outcome: 'aborted' };

export function literaturePreviewKindsForUrl(
  url: string,
): EphemeralPreviewKind[] {
  const kinds: EphemeralPreviewKind[] = [];
  // Paper first so OA PDF hosts win over generic .pdf book gate overlaps.
  if (isLikelyPaperPreviewUrl(url)) kinds.push('paper');
  if (isLikelyBookPreviewUrl(url)) kinds.push('book');
  return kinds;
}

export function literatureContentLooksPreviewable(
  kind: EphemeralPreviewKind,
  contentType: string,
): boolean {
  const ct = String(contentType || '').toLowerCase();
  if (kind === 'paper') return ct.includes('pdf');
  return (
    ct.includes('pdf') ||
    ct.includes('epub') ||
    ct.includes('djvu') ||
    ct.includes('text/plain') ||
    ct.includes('octet-stream')
  );
}

export function mimeFromLiteratureContentType(
  kind: EphemeralPreviewKind,
  contentType: string,
): string | undefined {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('pdf')) return 'application/pdf';
  if (ct.includes('epub')) return 'application/epub+zip';
  if (ct.includes('djvu')) return 'image/vnd.djvu';
  if (ct.includes('text/plain')) return 'text/plain';
  if (kind === 'paper') return 'application/pdf';
  return undefined;
}

export async function probeLiteratureContent(
  kind: EphemeralPreviewKind,
  identifier: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; contentType: string }
  | { ok: false; error: string }
  | { aborted: true }
> {
  const probe = await fetch(literatureContentUrl(kind, identifier), {
    method: 'GET',
    signal,
    credentials: 'same-origin',
  });
  if (signal?.aborted) return { aborted: true };
  const ct = (probe.headers.get('content-type') || '').toLowerCase();
  if (probe.ok && literatureContentLooksPreviewable(kind, ct)) {
    void probe.body?.cancel?.();
    return { ok: true, contentType: ct };
  }
  const errBody = await probe
    .json()
    .catch(() => ({} as { error?: string; message?: string }));
  return {
    ok: false,
    error: String(errBody.error || errBody.message || ''),
  };
}

/**
 * One kind attempt in the Preview ladder.
 * - ephemeral: open reader (no Files write)
 * - download_only: resolve ok but content not streamable → Save CTA
 * - cta: hard fail / junk host → CTA, no extract
 * - fallthrough: try next kind or HTML extract
 */
export async function attemptLiteratureEphemeralPreview(opts: {
  kind: EphemeralPreviewKind;
  url: string;
  title?: string;
  signal?: AbortSignal;
  resolve: (
    identifier: string,
    o?: { signal?: AbortSignal },
  ) => Promise<LiteratureResolveResult>;
  downloadOnlyFallback: string;
  resolveFailFallback: string;
}): Promise<LiteratureLadderOutcome> {
  const { kind, url, title, signal } = opts;
  const onResolveFail: 'cta' | 'fallthrough' =
    kind === 'book' && isJunkBookExtractHost(url) ? 'cta' : 'fallthrough';

  const resolved = await opts.resolve(url, { signal });
  if (signal?.aborted) return { outcome: 'aborted' };
  if (!resolved.ok) {
    if (onResolveFail === 'cta') {
      return {
        outcome: 'cta',
        message: friendlyLiteraturePreviewMessage(
          resolved.error,
          opts.resolveFailFallback,
        ),
      };
    }
    return { outcome: 'fallthrough' };
  }

  const probed = await probeLiteratureContent(kind, url, signal);
  if ('aborted' in probed) return { outcome: 'aborted' };
  if (probed.ok) {
    return {
      outcome: 'ephemeral',
      entry: ephemeralPreviewEntry({
        kind,
        identifier: url,
        title: resolved.title || title,
        filename: resolved.filename,
        mimeType: mimeFromLiteratureContentType(kind, probed.contentType),
      }),
    };
  }

  return {
    outcome: 'download_only',
    message: friendlyLiteraturePreviewMessage(
      probed.error,
      opts.downloadOnlyFallback,
    ),
  };
}

export type PersistedLiteraturePreviewEntry = {
  messageId: string;
  fileIndex: number;
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: number;
};

/** Persist via `/papers|/books download`, return a real Files preview entry. */
export async function persistLiteraturePreview(opts: {
  kind: EphemeralPreviewKind;
  identifier: string;
  download: (identifier: string) => Promise<LiteratureDownloadResult>;
  fallbackMimeType?: string;
  fallbackName?: string;
}): Promise<
  | { ok: true; entry: PersistedLiteraturePreviewEntry }
  | { ok: false; error: string }
> {
  const dl = await opts.download(opts.identifier);
  if (!dl.ok) return { ok: false, error: dl.error };
  const fallback = opts.kind === 'book' ? 'book' : 'paper';
  const mime =
    opts.fallbackMimeType ||
    (opts.kind === 'paper' ? 'application/pdf' : 'application/octet-stream');
  return {
    ok: true,
    entry: {
      messageId:
        opts.kind === 'book' ? 'url-preview-book' : 'url-preview-paper',
      fileIndex: 0,
      id: dl.fileId,
      name: dl.filename || `${dl.title || opts.fallbackName || fallback}.bin`,
      mimeType: mime,
      size: dl.bytes || 0,
      url: `/api/files/${encodeURIComponent(dl.fileId)}`,
      createdAt: Date.now(),
    },
  };
}

/** Save ephemeral Preview chrome Download → Files, then open real entry. */
export async function persistEphemeralLiteratureEntry(opts: {
  entry: { id: string; url: string; name: string; mimeType?: string; messageId: string; fileIndex: number };
  downloadPaper: (identifier: string) => Promise<LiteratureDownloadResult>;
  downloadBook: (identifier: string) => Promise<LiteratureDownloadResult>;
}): Promise<
  | { ok: true; entry: PersistedLiteraturePreviewEntry }
  | { ok: false; error: string }
  | { ok: false; skipped: true }
> {
  const kind = kindFromEphemeralPreviewId(opts.entry.id);
  if (!kind) return { ok: false, skipped: true };
  const identifier =
    identifierFromContentUrl(opts.entry.url) ||
    identifierFromEphemeralPreviewId(opts.entry.id, kind);
  if (!identifier) return { ok: false, error: 'Missing identifier' };
  return persistLiteraturePreview({
    kind,
    identifier,
    download: kind === 'book' ? opts.downloadBook : opts.downloadPaper,
    fallbackMimeType:
      kind === 'paper'
        ? 'application/pdf'
        : opts.entry.mimeType || 'application/octet-stream',
    fallbackName: opts.entry.name,
  });
}

export function noFileFallbackForKind(
  kind: EphemeralPreviewKind,
  messages: { noPaper: string; noBook: string },
): string {
  return kind === 'book' ? messages.noBook : messages.noPaper;
}
