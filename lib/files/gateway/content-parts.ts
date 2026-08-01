/** Build a Chat Completions content part that references a gateway file or raw URL. */
export function toImageContentPart(img: {
  fileId?: string | null;
  url?: string | null;
}): Record<string, unknown> | null {
  let fileId = img.fileId ? String(img.fileId).trim() : '';
  const url = img.url ? String(img.url).trim() : '';

  if (!fileId && url.startsWith('/api/files/')) {
    fileId = decodeURIComponent(url.slice('/api/files/'.length).split(/[?#]/)[0] || '');
  }

  if (fileId) {
    // NewAPI / many OpenAI-compatible gateways resolve Files API ids when
    // placed in image_url.url (vision). Prefer this over type:file for images.
    return {
      type: 'image_url',
      image_url: { url: fileId },
    };
  }

  if (!url || url.startsWith('/api/files/') || (url.startsWith('/') && !url.startsWith('data:'))) {
    return null;
  }

  return {
    type: 'image_url',
    image_url: { url },
  };
}
