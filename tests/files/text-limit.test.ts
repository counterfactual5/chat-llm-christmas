import { describe, expect, it } from 'vitest';
import {
  MAX_ATTACHMENT_TEXT_CHARS,
  truncateAttachmentText,
} from '@/lib/files/ingest/text-limit';

describe('truncateAttachmentText', () => {
  it('passes through short text', () => {
    expect(truncateAttachmentText('hello', 'a.txt')).toEqual({
      text: 'hello',
      truncated: false,
    });
  });

  it('clips oversized text and marks truncation', () => {
    const raw = 'x'.repeat(MAX_ATTACHMENT_TEXT_CHARS + 50);
    const { text, truncated } = truncateAttachmentText(raw, 'big.txt');
    expect(truncated).toBe(true);
    expect(text.startsWith('x'.repeat(MAX_ATTACHMENT_TEXT_CHARS))).toBe(true);
    expect(text).toContain('truncated');
    expect(text).toContain('big.txt');
  });
});
