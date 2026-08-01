import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadGeneratedFile, downloadGeneratedImage } from '@/lib/chat/composer/download';
import type {
  GeneratedFileEntry,
  GeneratedImageEntry,
} from '@/components/chat/panels/OutputPanel';

function stubAnchor() {
  const anchor = { href: '', download: '', click: vi.fn() };
  vi.stubGlobal('document', {
    createElement: vi.fn(() => anchor),
  });
  return anchor;
}

describe('downloadGeneratedImage', () => {
  let openMock: ReturnType<typeof vi.fn>;
  let createObjectURLMock: ReturnType<typeof vi.fn>;
  let revokeObjectURLMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openMock = vi.fn();
    createObjectURLMock = vi.fn(() => 'blob:image');
    revokeObjectURLMock = vi.fn();
    vi.stubGlobal('window', { open: openMock });
    vi.stubGlobal('URL', {
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const entry: GeneratedImageEntry = {
    messageId: 'm1',
    imageIndex: 0,
    url: 'https://example.com/cat.png',
    prompt: 'cat',
    model: 'demo',
    timestamp: 123,
  };

  it('downloads via a blob url derived from the fetched image', async () => {
    const anchor = stubAnchor();
    const blob = new Blob(['fake']);
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => blob })));

    await downloadGeneratedImage(entry);

    expect(createObjectURLMock).toHaveBeenCalledWith(blob);
    expect(anchor.href).toBe('blob:image');
    expect(anchor.download).toBe('image-123.png');
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:image');
    expect(openMock).not.toHaveBeenCalled();
  });

  it('falls back to opening the url when the fetch fails', async () => {
    stubAnchor();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));

    await downloadGeneratedImage(entry);

    expect(openMock).toHaveBeenCalledWith(entry.url, '_blank', 'noopener,noreferrer');
  });
});

describe('downloadGeneratedFile', () => {
  let openMock: ReturnType<typeof vi.fn>;
  let createObjectURLMock: ReturnType<typeof vi.fn>;
  let revokeObjectURLMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openMock = vi.fn();
    createObjectURLMock = vi.fn(() => 'blob:file');
    revokeObjectURLMock = vi.fn();
    vi.stubGlobal('window', { open: openMock });
    vi.stubGlobal('URL', {
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const baseEntry: GeneratedFileEntry = {
    messageId: 'm1',
    fileIndex: 0,
    id: 'f1',
    name: 'notes.txt',
    mimeType: 'text/plain',
    size: 5,
    url: '',
    createdAt: 456,
  };

  it('builds a blob from inline text content', async () => {
    const anchor = stubAnchor();

    await downloadGeneratedFile({ ...baseEntry, content: 'hello' });

    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(anchor.download).toBe('notes.txt');
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:file');
  });

  it('fetches remote urls when there is no inline content', async () => {
    const anchor = stubAnchor();
    const blob = new Blob(['remote']);
    const fetchMock = vi.fn(async () => ({ blob: async () => blob }));
    vi.stubGlobal('fetch', fetchMock);

    await downloadGeneratedFile({ ...baseEntry, url: 'https://example.com/notes.txt' });

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/notes.txt');
    expect(anchor.click).toHaveBeenCalledTimes(1);
  });

  it('falls back to opening a remote url when nothing else works', async () => {
    stubAnchor();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));

    await downloadGeneratedFile({ ...baseEntry, url: 'https://example.com/notes.txt' });

    expect(openMock).toHaveBeenCalledWith('https://example.com/notes.txt', '_blank', 'noopener,noreferrer');
  });

  it('does nothing when content is missing and the url is a local placeholder', async () => {
    stubAnchor();

    await downloadGeneratedFile({ ...baseEntry, url: 'local://pending' });

    expect(openMock).not.toHaveBeenCalled();
    expect(createObjectURLMock).not.toHaveBeenCalled();
  });
});
