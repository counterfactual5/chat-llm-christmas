/**
 * URL Preview panel image helpers — classify `![](src)` for render or
 * placeholder. Pure, no fetch. Used by AnswerMarkdown's img renderer when
 * `imageVariant === 'preview'`.
 */

import { resolvePreviewHttpUrl } from '@/lib/files/url-preview';

export type PreviewImageKind =
  | { kind: 'remote'; src: string }
  | { kind: 'skip' };

/**
 * Decide whether an extracted markdown `![alt](src)` is renderable.
 * - http(s) → remote (render as `<img>`, placeholder on error)
 * - relative / protocol-relative → try to resolve against the preview base URL
 * - `data:` / `blob:` / empty / unresolved → skip (immediately placeholder)
 */
export function classifyPreviewImageSrc(
  src: unknown,
  baseUrl?: string,
): PreviewImageKind {
  const s = String(src || '').trim();
  if (!s) return { kind: 'skip' };
  if (/^https?:\/\//i.test(s)) return { kind: 'remote', src: s };
  if (/^(data|blob|javascript|about):/i.test(s)) return { kind: 'skip' };
  if (s.startsWith('#')) return { kind: 'skip' };
  // relative / `#fragment` / protocol-relative: only viable with a base URL
  if (!baseUrl) return { kind: 'skip' };
  const resolved = resolvePreviewHttpUrl(s, baseUrl);
  if (!resolved) return { kind: 'skip' };
  return { kind: 'remote', src: resolved };
}

/** Cap alt text shown on placeholder cards. */
export const PREVIEW_IMAGE_ALT_MAX = 80;

export function truncateImageAlt(alt: unknown, max = PREVIEW_IMAGE_ALT_MAX): string {
  const s = String(alt || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** Cap the understood description rendered back into the placeholder. */
export const PREVIEW_IMAGE_DESC_MAX = 600;

export function truncateImageDescription(text: unknown, max = PREVIEW_IMAGE_DESC_MAX): string {
  const s = String(text || '').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
