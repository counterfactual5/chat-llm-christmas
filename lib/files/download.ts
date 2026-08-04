/**
 * Trigger a browser download from a Blob, object URL, or remote href.
 */

/** Click an ephemeral `<a download>` (works for blob: and same-origin URLs). */
export function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  // Prefer attaching to body when available (some browsers ignore detached clicks).
  const body = typeof document !== 'undefined' ? document.body : null;
  if (body) {
    body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  a.click();
}

/** Blob → object URL → download → revoke. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    triggerDownload(url, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** UTF-8 text file download helper. */
export function downloadTextContent(
  filename: string,
  content: string,
  mimeType = 'text/plain;charset=utf-8',
): void {
  downloadBlob(new Blob([content], { type: mimeType }), filename);
}
