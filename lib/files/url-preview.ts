/**
 * Helpers for side-panel online URL preview (not account file preview).
 */

/** True for absolute http(s) URLs that belong in the URL Preview panel. */
export function isPreviewableHttpUrl(raw: string): boolean {
  const s = String(raw || '').trim();
  if (!s) return false;
  // Skip in-app file proxies and non-web schemes.
  if (s.startsWith('/api/files/') || s.startsWith('local://') || s.startsWith('data:')) {
    return false;
  }
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Normalize user-pasted / markdown hrefs into an absolute http(s) URL.
 * Returns '' when the input cannot become a previewable web URL.
 */
export function normalizePreviewHttpUrl(raw: string): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('/api/files/') || s.startsWith('local://') || s.startsWith('data:')) {
    return '';
  }
  // Bare domains / paths without a scheme — prefer https.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) {
    s = `https://${s}`;
  }
  if (!isPreviewableHttpUrl(s)) return '';
  try {
    return new URL(s).href;
  } catch {
    return '';
  }
}

/** True when a click should open in a new tab instead of the Preview panel. */
export function shouldOpenLinkExternally(e: {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  button?: number;
}): boolean {
  return Boolean(
    e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1,
  );
}
