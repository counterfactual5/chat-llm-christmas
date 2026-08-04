import type {
  GeneratedFileEntry,
  GeneratedImageEntry,
} from '@/components/chat/panels/OutputPanel';
import { downloadBlob, triggerDownload } from '@/lib/files/download';

export { triggerDownload, downloadBlob, downloadTextContent } from '@/lib/files/download';

/** Downloads a generated image via blob fetch, falling back to opening the url. */
export async function downloadGeneratedImage(entry: GeneratedImageEntry): Promise<void> {
  try {
    const res = await fetch(entry.url);
    const blob = await res.blob();
    downloadBlob(blob, `image-${entry.timestamp}.png`);
  } catch {
    window.open(entry.url, '_blank', 'noopener,noreferrer');
  }
}

/** Downloads a generated file (inline text content or remote url), falling back to opening the url. */
export async function downloadGeneratedFile(entry: GeneratedFileEntry): Promise<void> {
  try {
    let blob: Blob;
    // Prefer remote binary URL when present — `content` may be a text extract for preview only
    // (e.g. create_spreadsheet stores TSV extract alongside an .xlsx url).
    if (entry.url && !entry.url.startsWith('local://')) {
      const res = await fetch(entry.url);
      if (!res.ok) {
        throw new Error(`Download failed (${res.status})`);
      }
      blob = await res.blob();
    } else if (typeof entry.content === 'string') {
      blob = new Blob([entry.content], {
        type: entry.mimeType || 'text/plain;charset=utf-8',
      });
    } else {
      throw new Error('No file content available');
    }
    downloadBlob(blob, entry.name || `file-${entry.createdAt}`);
  } catch {
    if (entry.url && !entry.url.startsWith('local://')) {
      window.open(entry.url, '_blank', 'noopener,noreferrer');
    }
  }
}
