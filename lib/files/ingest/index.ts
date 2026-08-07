/**
 * Client-side file ingestion (thin). Browser validates + compresses images +
 * reads small plain-text files; bytes for docs (pdf/docx/epub/pptx/xlsx/zip)
 * upload as opaque blobs. Authoritative extract lives on chat-api.
 */

import type { IngestedAttachment } from './types';
import {
  isLegacyOleOfficeFile,
  isPresentationFile,
  isSpreadsheetWorkbookFile,
  isSupportedDropFile,
  isZipArchiveFile,
  PPTX_MIME,
  ZIP_MIME,
} from './support';
import { MAX_INGEST_BYTES, prepareImageForUpload } from './compress-image';

export type { IngestedAttachment } from './types';
export {
  isSupportedDropFile,
  isPresentationFile,
  isZipArchiveFile,
  isSpreadsheetWorkbookFile,
  isLegacyOleOfficeFile,
  PPTX_MIME,
  ZIP_MIME,
} from './support';
export { MAX_INGEST_BYTES, MAX_UPLOAD_BYTES } from './compress-image';
export { MAX_ATTACHMENT_TEXT_CHARS, truncateAttachmentText } from './text-limit';

export async function ingestFile(file: File): Promise<IngestedAttachment> {
  const base: IngestedAttachment = {
    id: crypto.randomUUID(),
    name: file.name || 'untitled',
    type: file.type || 'application/octet-stream',
    size: file.size,
  };

  const name = file.name.toLowerCase();

  if (file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)$/i.test(name)) {
    // Browser canvas compress — Edge chat cannot reliably downscale for vision.
    const prepared = await prepareImageForUpload(file);
    return {
      ...base,
      name: prepared.filename,
      type: prepared.mime.startsWith('image/') ? prepared.mime : 'image/jpeg',
      size: prepared.size,
      dataUrl: prepared.dataUrl,
      previewUrl: URL.createObjectURL(prepared.blob),
      /** Compressed bytes for multipart upload (vision-inline friendly). */
      uploadBlob: prepared.blob,
    };
  }

  if (isLegacyOleOfficeFile(file)) {
    if (name.endsWith('.ppt')) {
      throw new Error('Legacy .ppt is not supported — please save as .pptx and try again');
    }
    throw new Error('Legacy .doc is not supported — please save as .docx and try again');
  }

  // Docs / archives: bytes only. chat-api runs the parser and serves extract
  // via GET /files/:id/extract once sidecar is ready.
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    return { ...base, type: file.type || 'application/pdf', uploadBlob: file };
  }

  if (
    name.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return {
      ...base,
      type:
        file.type ||
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      uploadBlob: file,
    };
  }

  if (name.endsWith('.epub') || file.type === 'application/epub+zip') {
    return { ...base, type: file.type || 'application/epub+zip', uploadBlob: file };
  }

  if (isPresentationFile(file)) {
    return { ...base, type: file.type || PPTX_MIME, uploadBlob: file };
  }

  if (isZipArchiveFile(file)) {
    return { ...base, type: file.type || ZIP_MIME, uploadBlob: file };
  }

  if (isSpreadsheetWorkbookFile(file)) {
    return {
      ...base,
      type:
        file.type ||
        (name.endsWith('.xls')
          ? 'application/vnd.ms-excel'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      uploadBlob: file,
    };
  }

  // Plain text: chat composer wants the body inline.
  const text = await file.text();
  return {
    ...base,
    type: file.type || 'text/plain',
    text,
    uploadBlob: file,
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
