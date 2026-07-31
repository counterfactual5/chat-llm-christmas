import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  driveExportFile,
  driveSearchFiles,
  driveUploadFile,
} from '@/lib/integrations/google/drive';

describe('Google Drive helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('caps search page size and forwards query pagination parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ files: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await driveSearchFiles('token-123', {
      query: "name contains 'report'",
      pageSize: 100,
      pageToken: 'next-page',
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/drive/v3/files');
    expect(parsed.searchParams.get('pageSize')).toBe('50');
    expect(parsed.searchParams.get('q')).toBe("name contains 'report'");
    expect(parsed.searchParams.get('pageToken')).toBe('next-page');
  });

  it('exports spreadsheets as CSV when no target MIME type is supplied', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'sheet-1',
            name: 'Budget',
            mimeType: 'application/vnd.google-apps.spreadsheet',
            webViewLink: 'https://docs.google.com/spreadsheets/d/sheet-1',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('month,total\nJan,10', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(driveExportFile('token-123', { fileId: 'sheet-1' })).resolves.toMatchObject({
      exportMimeType: 'text/csv',
      content: 'month,total\nJan,10',
    });

    expect(fetchMock.mock.calls[1]?.[0]).toContain('mimeType=text%2Fcsv');
  });

  it('rejects uploads larger than the chat safety limit before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      driveUploadFile('token-123', {
        name: 'large.txt',
        content: 'a'.repeat(1_500_001),
      }),
    ).rejects.toThrow('Upload too large for chat tool');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
