/** Client-side file ingestion: read/extract dropped files into attachments. */

import type { IngestedAttachment } from './types';
import { extractDocxText, extractPdfText } from './extractors';
import { isSupportedDropFile } from './support';
import { MAX_INGEST_BYTES, prepareImageForUpload } from './compress-image';
import { truncateAttachmentText } from './text-limit';

export type { IngestedAttachment } from './types';
export { isSupportedDropFile } from './support';
export { MAX_INGEST_BYTES, MAX_UPLOAD_BYTES } from './compress-image';
export { MAX_ATTACHMENT_TEXT_CHARS, truncateAttachmentText } from './text-limit';

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
    const prepared = await prepareImageForUpload(file);
    return {
      ...base,
      name: prepared.filename,
      type: prepared.mime.startsWith('image/') ? prepared.mime : 'image/jpeg',
      size: prepared.size,
      dataUrl: prepared.dataUrl,
      previewUrl: URL.createObjectURL(prepared.blob),
      /** Keep binary for multipart upload (avoids base64 inflation on /api/files). */
      uploadBlob: prepared.blob,
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
