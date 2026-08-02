/** Soft ceiling for extracted attachment text embedded into /api/chat.
 *  Leaves headroom under Vercel’s ~4.5MB JSON body (and model context). */
export const MAX_ATTACHMENT_TEXT_CHARS = 500_000;

/** Truncate extracted file text and append a clear marker when clipped. */
export function truncateAttachmentText(text: string, filename = 'file'): {
  text: string;
  truncated: boolean;
} {
  const raw = String(text || '');
  if (raw.length <= MAX_ATTACHMENT_TEXT_CHARS) {
    return { text: raw, truncated: false };
  }
  return {
    text:
      raw.slice(0, MAX_ATTACHMENT_TEXT_CHARS) +
      `\n\n[…truncated: kept first ${MAX_ATTACHMENT_TEXT_CHARS.toLocaleString()} characters of ${filename}; full binary is stored when upload succeeds]`,
    truncated: true,
  };
}
