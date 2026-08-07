/**
 * Pure mapping from extract wait result → preview panel content/error.
 * Keeps ChatPreviewPanel free of extract-branch logic so vitest can cover it
 * without React Testing Library.
 */

import type { FileExtractSidecarResult } from '@/lib/files/ensure-file-extract';
import { waitForSharedFileExtractSidecar } from '@/lib/files/ensure-file-extract';

export type ExtractSidecarPreviewState =
  | { status: 'ready'; content: string }
  | { status: 'failed'; error: string }
  | { status: 'aborted' };

export function previewStateFromExtractWait(
  result: FileExtractSidecarResult,
  failedMessage: string,
): ExtractSidecarPreviewState {
  if (!result.ok) {
    if (result.code === 'ABORTED') return { status: 'aborted' };
    return {
      status: 'failed',
      error: result.error || failedMessage,
    };
  }
  const body = String(result.text || '');
  // OCR-ready empty extract is "ready" for file_read, but preview has nothing
  // to render — treat as failure instead of a blank markdown pane.
  if (!body.trim()) {
    return { status: 'failed', error: failedMessage };
  }
  return { status: 'ready', content: body };
}

export async function loadExtractSidecarPreviewContent(opts: {
  fileId: string;
  signal?: AbortSignal;
  failedMessage: string;
}): Promise<ExtractSidecarPreviewState> {
  const result = await waitForSharedFileExtractSidecar({
    fileId: opts.fileId,
    signal: opts.signal,
  });
  return previewStateFromExtractWait(result, opts.failedMessage);
}
