/**
 * Helpers for side-panel online URL preview (not account file preview).
 */

/**
 * Hosts that almost never work in a cross-origin iframe and require the user's
 * first-party browser session (cookies / SSO). Side-panel embed + server
 * `web_read` cannot reuse that login; prefer top-level open-in-browser.
 *
 * Match apex + subdomains (e.g. www.notion.so, workspace.slack.com).
 */
const AUTH_GATED_PREVIEW_HOST_SUFFIXES = [
  'notion.so',
  'notion.site',
  'docs.google.com',
  'drive.google.com',
  'sheets.google.com',
  'slides.google.com',
  'figma.com',
  'linear.app',
  'slack.com',
  'atlassian.net',
  'github.com',
] as const;

function hostMatchesSuffix(hostname: string, suffix: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  const s = suffix.toLowerCase();
  return h === s || h.endsWith(`.${s}`);
}

/**
 * True when in-panel iframe/extract is unlikely to show the logged-in page.
 * Callers should skip embed and surface an open-in-browser CTA instead.
 */
export function isLikelyAuthGatedPreviewUrl(raw: string): boolean {
  try {
    const u = new URL(String(raw || '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return AUTH_GATED_PREVIEW_HOST_SUFFIXES.some((suffix) =>
      hostMatchesSuffix(u.hostname, suffix),
    );
  } catch {
    return false;
  }
}

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
