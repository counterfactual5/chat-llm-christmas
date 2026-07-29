export type IngestedAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  text?: string;
  /** data: URL for images (legacy / offline fallback) */
  dataUrl?: string;
  previewUrl?: string;
  /** Gateway Files API id after upload — preferred for chat. */
  fileId?: string;
  /** Client-side upload state when account-bound upload is in progress. */
  uploading?: boolean;
};

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  // Pin worker to the installed package version via CDN to avoid bundler path issues.
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  const limit = Math.min(doc.numPages, 40);
  for (let i = 1; i <= limit; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item: any) => item.str || '').join(' '));
  }
  if (doc.numPages > limit) {
    pages.push(`\n[…truncated: showing first ${limit} of ${doc.numPages} pages]`);
  }
  return pages.join('\n\n').trim();
}

async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return String(result.value || '').trim();
}

export function isSupportedDropFile(file: File): boolean {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('image/')) return true;
  if (file.type.startsWith('text/') || file.type === 'application/json') return true;
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return true;
  if (
    name.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return true;
  }
  if (name.endsWith('.doc')) return true;
  if (/\.(md|txt|csv|tsv|json|js|ts|tsx|jsx|py|go|rs|java|c|cpp|h|css|html|xml|yaml|yml|toml|sh)$/i.test(name)) {
    return true;
  }
  return false;
}

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
