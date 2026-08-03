/** Client-side file ingestion: read/extract dropped files into attachments. */

import type { IngestedAttachment } from './types';
import { extractDocxText, extractPdfText } from './extractors';
import { isSupportedDropFile } from './support';
import { truncateAttachmentText } from './text-limit';

/** Hard reject before we even try to read (aligned with chat-api FILE_UPLOAD_MAX_BYTES). */
export const MAX_INGEST_BYTES = 20 * 1024 * 1024;

export type { IngestedAttachment } from './types';
export { isSupportedDropFile } from './support';
export { MAX_ATTACHMENT_TEXT_CHARS, truncateAttachmentText } from './text-limit';

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(blob);
  });
}

function withUploadBlob(file: File, text: string): Pick<IngestedAttachment, 'text' | 'uploadBlob'> {
  const clipped = truncateAttachmentText(text, file.name || 'file');
  return {
    text: clipped.text,
    /** Keep original bytes for browser → chat-api direct upload. */
    uploadBlob: file,
  };
}

export async function ingestFile(file: File): Promise<IngestedAttachment> {
  const base: IngestedAttachment = {
    id: crypto.randomUUID(),
    name: file.name || 'untitled',
    type: file.type || 'application/octet-stream',
    size: file.size,
  };

  const name = file.name.toLowerCase();

  if (file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)$/i.test(name)) {
    const dataUrl = await readAsDataUrl(file);
    return {
      ...base,
      type: file.type?.startsWith('image/') ? file.type : 'image/jpeg',
      dataUrl,
      previewUrl: URL.createObjectURL(file),
      /** Original bytes for multipart upload (no client-side compress). */
      uploadBlob: file,
    };
  }

  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    const text = await extractPdfText(file);
    if (!text) throw new Error(`Could not extract text from ${file.name}`);
    return {
      ...base,
      type: file.type || 'application/pdf',
      ...withUploadBlob(file, text),
    };
  }

  if (
    name.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const text = await extractDocxText(file);
    if (!text) throw new Error(`Could not extract text from ${file.name}`);
    return {
      ...base,
      type:
        file.type ||
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ...withUploadBlob(file, text),
    };
  }

  if (name.endsWith('.doc')) {
    throw new Error('Legacy .doc is not supported — please save as .docx and try again');
  }

  const text = await file.text();
  return {
    ...base,
    type: file.type || 'text/plain',
    ...withUploadBlob(file, text),
  };
}

export async function ingestFiles(files: FileList | File[]): Promise<{
  attachments: IngestedAttachment[];
  errors: string[];
}> {
  const list = Array.from(files);
  const attachments: IngestedAttachment[] = [];
  const errors: string[] = [];

  for (const file of list) {
    if (!isSupportedDropFile(file)) {
      errors.push(`Unsupported file type: ${file.name}`);
      continue;
    }
    if (file.size > MAX_INGEST_BYTES) {
      errors.push(`${file.name} is larger than 20MB`);
      continue;
    }
    try {
      attachments.push(await ingestFile(file));
    } catch (err: any) {
      errors.push(`${file.name}: ${err?.message || 'failed to read'}`);
    }
  }

  return { attachments, errors };
}
