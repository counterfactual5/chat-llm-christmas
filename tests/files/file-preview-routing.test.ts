import { describe, expect, it } from 'vitest';
import {
  isMarkdownPreview,
  prefersAnswerMarkdownPreview,
} from '@/components/files/FilePreviewOverlay';

describe('file preview routing', () => {
  it('treats markdown names/mimes as markdown', () => {
    expect(isMarkdownPreview({ name: 'notes.md', mimeType: 'text/plain' })).toBe(true);
    expect(
      isMarkdownPreview({ name: 'x.bin', mimeType: 'text/markdown' }),
    ).toBe(true);
  });

  it('routes .txt / text/plain through AnswerMarkdown for ASCII recovery', () => {
    expect(
      prefersAnswerMarkdownPreview({ name: 'diagram.txt', mimeType: 'text/plain' }),
    ).toBe(true);
    expect(
      prefersAnswerMarkdownPreview({ name: 'a.text', mimeType: 'application/octet-stream' }),
    ).toBe(true);
    expect(
      prefersAnswerMarkdownPreview({ name: 'app.ts', mimeType: 'text/typescript' }),
    ).toBe(false);
  });
});
