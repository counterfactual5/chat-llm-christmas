import { afterEach, describe, expect, it } from 'vitest';
import { gatewayBaseURL, resolveUploadModel } from '@/lib/files/gateway/base';
import { parseDataUrl } from '@/lib/files/gateway/data-url';
import { toImageContentPart } from '@/lib/files/gateway/content-parts';
import { generatedImageAssistantSummary } from '@/lib/files/gateway/prompts';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('gatewayBaseURL', () => {
  it('defaults when env is unset', () => {
    delete process.env.LLM_CHRISTMAS_BASE_URL;
    expect(gatewayBaseURL()).toBe('https://api.llm.christmas/v1');
  });

  it('strips a trailing slash from the env override', () => {
    process.env.LLM_CHRISTMAS_BASE_URL = 'https://example.com/v1/';
    expect(gatewayBaseURL()).toBe('https://example.com/v1');
  });
});

describe('resolveUploadModel', () => {
  it('prefers the explicit model', () => {
    expect(resolveUploadModel('gpt-4o-mini')).toBe('gpt-4o-mini');
  });

  it('falls back to env then the gpt-4o default', () => {
    delete process.env.LLM_CHRISTMAS_FILE_MODEL;
    expect(resolveUploadModel()).toBe('gpt-4o');
    process.env.LLM_CHRISTMAS_FILE_MODEL = 'custom-model';
    expect(resolveUploadModel()).toBe('custom-model');
  });

  it('trims whitespace and treats blank as unset', () => {
    expect(resolveUploadModel('   ')).toBe('gpt-4o');
    expect(resolveUploadModel('  gpt-4o-mini  ')).toBe('gpt-4o-mini');
  });
});

describe('parseDataUrl', () => {
  it('decodes a base64 data URL into mime + bytes', () => {
    const parsed = parseDataUrl('data:image/png;base64,aGVsbG8=');
    expect(parsed?.mime).toBe('image/png');
    expect(Buffer.from(parsed!.bytes).toString('utf8')).toBe('hello');
  });

  it('returns null for non-data URLs or missing base64 payload', () => {
    expect(parseDataUrl('https://example.com/a.png')).toBeNull();
    expect(parseDataUrl('data:image/png,notbase64')).toBeNull();
  });
});

describe('toImageContentPart', () => {
  it('prefers a fileId when present', () => {
    expect(toImageContentPart({ fileId: 'file-123' })).toEqual({
      type: 'image_url',
      image_url: { url: 'file-123' },
    });
  });

  it('extracts a file id from a /api/files/ url', () => {
    expect(toImageContentPart({ url: '/api/files/file-abc?x=1' })).toEqual({
      type: 'image_url',
      image_url: { url: 'file-abc' },
    });
  });

  it('returns a raw image_url for remote/data urls without a file id', () => {
    expect(toImageContentPart({ url: 'https://example.com/a.png' })).toEqual({
      type: 'image_url',
      image_url: { url: 'https://example.com/a.png' },
    });
    expect(toImageContentPart({ url: 'data:image/png;base64,abc' })).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,abc' },
    });
  });

  it('returns null when there is nothing usable', () => {
    expect(toImageContentPart({})).toBeNull();
    expect(toImageContentPart({ url: '/local/path.png' })).toBeNull();
  });
});

describe('generatedImageAssistantSummary', () => {
  it('joins cleaned prompts into the summary', () => {
    const summary = generatedImageAssistantSummary([' a cat ', '', 'in the snow']);
    expect(summary).toContain('Image prompt: a cat; in the snow');
  });

  it('falls back to a placeholder when no prompts are given', () => {
    const summary = generatedImageAssistantSummary([]);
    expect(summary).toContain('Image prompt: (see prior user /image command)');
  });
});
