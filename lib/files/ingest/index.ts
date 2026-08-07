/** Client-side file ingestion: read/extract dropped files into attachments. */

import type { IngestedAttachment } from './types';
import {
  extractEpubTextFromBytes,
  extractZipText,
} from './extractors';
import { extractWithAnydocFallback } from './anydoc';
import {
  isLegacyOleOfficeFile,
  isPresentationFile,
  isSpreadsheetWorkbookFile,
  isSupportedDropFile,
  isZipArchiveFile,
  PPTX_MIME,
  ZIP_MIME,
} from './support';
import { truncateAttachmentText } from './text-limit';
import { MAX_INGEST_BYTES, prepareImageForUpload } from './compress-image';

export type { IngestedAttachment } from './types';
export {
  isSupportedDropFile,
  isPresentationFile,
  isZipArchiveFile,
  PPTX_MIME,
  ZIP_MIME,
} from './support';
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

  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    const text = await extractWithAnydocFallback(file);
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
    const text = await extractWithAnydocFallback(file);
    if (!text) throw new Error(`Could not extract text from ${file.name}`);
    return {
      ...base,
      type:
        file.type ||
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ...withUploadBlob(file, text),
    };
  }

  if (isLegacyOleOfficeFile(file)) {
    if (name.endsWith('.ppt')) {
      throw new Error('Legacy .ppt is not supported — please save as .pptx and try again');
    }
    throw new Error('Legacy .doc is not supported — please save as .docx and try again');
  }

  if (name.endsWith('.epub') || file.type === 'application/epub+zip') {
    const data = new Uint8Array(await file.arrayBuffer());
    const text = await extractEpubTextFromBytes(data);
    if (!text) throw new Error(`Could not extract text from ${file.name}`);
    return {
      ...base,
      type: file.type || 'application/epub+zip',
      ...withUploadBlob(file, text),
    };
  }

  if (isPresentationFile(file)) {
    const text = await extractWithAnydocFallback(file);
    if (!text) throw new Error(`Could not extract text from ${file.name}`);
    return {
      ...base,
      type: file.type || PPTX_MIME,
      ...withUploadBlob(file, text),
    };
  }

  if (isZipArchiveFile(file)) {
    const text = await extractZipText(file);
    if (!text) throw new Error(`Could not extract text from ${file.name}`);
    return {
      ...base,
      type: file.type || ZIP_MIME,
      ...withUploadBlob(file, text),
    };
  }

  if (isSpreadsheetWorkbookFile(file)) {
    // Don't route spreadsheets through anydoc: SheetJS keeps sheet/catalog
    // structure that anydoc's CSV-style markdown loses.
    const { extractSpreadsheetText } = await import('./extractors');
    const text = await extractSpreadsheetText(file);
    if (!text) throw new Error(`Could not extract cells from ${file.name}`);
    return {
      ...base,
      type:
        file.type ||
        (name.endsWith('.xls')
          ? 'application/vnd.ms-excel'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      ...withUploadBlob(file, text),
    };
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
