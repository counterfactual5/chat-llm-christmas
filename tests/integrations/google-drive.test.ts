import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  driveEnsureFolder,
  driveExportFile,
  driveMoveFile,
  driveResolvePath,
  driveSearchFiles,
  driveTrashByQuery,
  driveUploadFile,
  escapeDriveQueryLiteralForTest,
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

  it('moves a file by replacing parents', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'f1', name: 'doc', parents: ['old-parent'] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'f1', name: 'doc', parents: ['new-parent'] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await driveMoveFile('token-123', { fileId: 'f1', destinationFolderId: 'new-parent' });
    const [url] = fetchMock.mock.calls[1] as [string];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('addParents')).toBe('new-parent');
    expect(parsed.searchParams.get('removeParents')).toBe('old-parent');
  });

  it('refuses move when parents metadata is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'f1', name: 'doc' }), { status: 200 }),
      ),
    );
    await expect(
      driveMoveFile('token-123', { fileId: 'f1', destinationFolderId: 'dest' }),
    ).rejects.toThrow(/parents are unknown/);
  });

  it('trashes files matching a query and refuses empty query', async () => {
    await expect(driveTrashByQuery('token-123', { query: '  ' })).rejects.toThrow(
      'query is required',
    );

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (String(init?.method || 'GET').toUpperCase() === 'PATCH') {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'a', name: 'old.pdf', trashed: true }), {
            status: 200,
          }),
        );
      }
      expect(String(url)).toContain('trashed%3Dfalse');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            files: [{ id: 'a', name: 'old.pdf' }, { id: 'b', name: 'old2.pdf' }],
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await driveTrashByQuery('token-123', {
      query: "name contains 'old'",
    });
    expect(out).toMatchObject({ ok: true, requested: 2, trashed: 2, failed: 0 });
    expect(out.sample).toHaveLength(2);
    expect(out.query).toContain('trashed=false');
  });

  it('resolves and ensures folder paths', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'work-id',
              name: 'Work',
              mimeType: 'application/vnd.google-apps.folder',
            }),
            { status: 200 },
          ),
        );
      }
      // First resolve: Documents exists, Work missing
      if (String(url).includes("name%3D%27Documents%27") || String(url).includes("name='Documents'")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              files: [
                {
                  id: 'docs-id',
                  name: 'Documents',
                  mimeType: 'application/vnd.google-apps.folder',
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      if (String(url).includes('docs-id') || String(url).includes('Documents')) {
        // child lookup under Documents for Work — empty then created
        return Promise.resolve(new Response(JSON.stringify({ files: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ files: [] }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const missing = await driveResolvePath('token-123', { path: 'Documents/Work' });
    expect(missing.ok).toBe(false);

    // Re-stub a clearer sequence for ensure
    const ensureMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body || '{}')) as { name?: string };
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: body.name === 'Documents' ? 'docs-id' : 'work-id',
              name: body.name,
              mimeType: 'application/vnd.google-apps.folder',
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ files: [] }), { status: 200 }));
    });
    vi.stubGlobal('fetch', ensureMock);

    const ensured = await driveEnsureFolder('token-123', { path: 'Documents/Work' });
    expect(ensured).toMatchObject({
      ok: true,
      folderId: 'work-id',
      path: 'Documents/Work',
    });
    expect(ensured.resolved.every((r) => r.created)).toBe(true);
  });

  it('escapes backslash and quotes in Drive query literals', () => {
    expect(escapeDriveQueryLiteralForTest("O'Reilly")).toBe("O\\'Reilly");
    expect(escapeDriveQueryLiteralForTest('a\\b')).toBe('a\\\\b');
    expect(escapeDriveQueryLiteralForTest("a\\b'c")).toBe("a\\\\b\\'c");
  });
});
