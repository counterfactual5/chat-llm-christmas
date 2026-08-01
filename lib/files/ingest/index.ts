/** Client-side file ingestion: read/extract dropped files into attachments. */

import type { IngestedAttachment } from './types';
import { extractDocxText, extractPdfText, readAsDataUrl } from './extractors';
import { isSupportedDropFile } from './support';

export type { IngestedAttachment } from './types';
export { isSupportedDropFile } from './support';

export async function ingestFile(file: File): Promise<IngestedAttachment> {
  const base: IngestedAttachment = {
    id: crypto.randomUUID(),
    name: file.name || 'untitled',
    type: file.type || 'application/octet-stream',
    size: file.size,
  };

  const name = file.name.toLowerCase();

  if (file.type.startsWith('image/')) {
    const dataUrl = await readAsDataUrl(file);
    return {
      ...base,
      dataUrl,
      previewUrl: URL.createObjectURL(file),
    };
  }

  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    const text = await extractPdfText(file);
    if (!text) throw new Error(`Could not extract text from ${file.name}`);
    return { ...base, text };
  }

  if (
    name.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const text = await extractDocxText(file);
    if (!text) throw new Error(`Could not extract text from ${file.name}`);
    return { ...base, text };
  }

  if (name.endsWith('.doc')) {
    throw new Error('Legacy .doc is not supported — please save as .docx and try again');
  }

  const text = await file.text();
  return { ...base, text };
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
    if (file.size > 20 * 1024 * 1024) {
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
