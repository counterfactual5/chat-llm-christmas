import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFileReadTool } from '@/lib/tools/file-read/tool';
import type { ToolRuntimeContext } from '@/lib/tools/registry';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeCtx(
  overrides: Partial<ToolRuntimeContext> = {},
): ToolRuntimeContext {
  return {
    userAsk: 'summarize',
    send: vi.fn(),
    gateway: { apiKey: 'sk-test', baseURL: 'https://api.llm.christmas/v1' },
    fileExtracts: {},
    ...overrides,
  };
}

type GatewayHandlers = {
  meta?: () => Response;
  extract: () => Response;
  content?: () => Response;
  ocr?: () => Response;
};

function stubGateway(handlers: GatewayHandlers) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'POST' && url.includes('/ocr-pages')) {
        return handlers.ocr?.() ?? jsonResponse({ text: '', ocr_pages: [] });
      }
      if (url.includes('/extract')) return handlers.extract();
      if (url.includes('/content')) {
        return (
          handlers.content?.() ??
          new Response('missing', { status: 404 })
        );
      }
      return (
        handlers.meta?.() ??
        jsonResponse({
          filename: 'report.docx',
          mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
      );
    }),
  );
}

async function runFileRead(
  fileId: string,
  ctx: ToolRuntimeContext,
): Promise<Record<string, unknown>> {
  const tool = createFileReadTool();
  const result = await tool.execute(
    {
      callId: 'call-1',
      rawArguments: JSON.stringify({ file_id: fileId }),
      fallbackQuery: '',
    },
    ctx,
  );
  return JSON.parse(result.content) as Record<string, unknown>;
}

describe('file_read EXTRACT_PENDING + directive cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns EXTRACT_PENDING when extract is partial with empty body and not OCR-ready', async () => {
    vi.useFakeTimers();
    stubGateway({
      extract: () =>
        jsonResponse({
          text: '',
          chars: 0,
          partial: true,
          filename: 'report.docx',
        }),
    });

    const pending = runFileRead('file-pending-1', makeCtx());
    await vi.advanceTimersByTimeAsync(6_000);
    const out = await pending;
    vi.useRealTimers();
    expect(out.ok).toBe(false);
    expect(out.code).toBe('EXTRACT_PENDING');
    expect(String(out.error || '')).toMatch(/still being built|call file_read again/i);
    expect(String(out.tip || '')).toMatch(/still building|call file_read again/i);
  });

  it('succeeds when extract becomes ready within the short pending wait', async () => {
    vi.useFakeTimers();
    let n = 0;
    stubGateway({
      extract: () => {
        n += 1;
        if (n === 1) {
          return jsonResponse({
            text: '',
            chars: 0,
            partial: true,
            filename: 'report.docx',
          });
        }
        const body = [
          '--- page 1 ---',
          '',
          'Ready after short wait.',
        ].join('\n');
        return jsonResponse({
          text: body,
          chars: body.length,
          partial: false,
          filename: 'report.docx',
        });
      },
    });

    const pending = runFileRead('file-pending-ready', makeCtx());
    await vi.advanceTimersByTimeAsync(1_000);
    const out = await pending;
    vi.useRealTimers();
    expect(out.ok).toBe(true);
    expect(String(out.text || '')).toContain('Ready after short wait');
  });

  it('still succeeds when partial extract has sliceable text', async () => {
    const body = [
      '--- page 1 ---',
      '',
      '# outline',
      '',
      '--- page 2 ---',
      '',
      'Chapter body with enough text for a slice.',
    ].join('\n');
    stubGateway({
      extract: () =>
        jsonResponse({
          text: body,
          chars: body.length,
          partial: true,
          total_pages: 10,
          extracted_pages: 2,
          filename: 'report.docx',
        }),
    });

    const out = await runFileRead('file-partial-text', makeCtx());
    expect(out.ok).toBe(true);
    expect(out.partial_extract).toBe(true);
    expect(String(out.text || '')).toContain('Chapter body');
  });

  it('does not treat needs_ocr placeholder as EXTRACT_PENDING', async () => {
    stubGateway({
      extract: () =>
        jsonResponse({
          text: '',
          chars: 0,
          partial: true,
          needs_ocr: true,
          pages_needing_ocr: [1, 2],
          pdf_type: 'Scanned',
          total_pages: 2,
          extracted_pages: 0,
          filename: 'scan.pdf',
          mime: 'application/pdf',
        }),
      ocr: () =>
        jsonResponse({
          text: [
            '--- page 1 ---',
            '',
            'OCR page one text for the scanned document.',
            '',
            '--- page 2 ---',
            '',
            'OCR page two.',
          ].join('\n'),
          ocr_pages: [
            { page: 1, provider: 'test', chars: 40 },
            { page: 2, provider: 'test', chars: 12 },
          ],
          pages_needing_ocr: [],
          needs_ocr: false,
        }),
    });

    const out = await runFileRead(
      'file-ocr-1',
      makeCtx({
        gateway: { apiKey: 'sk-test', baseURL: 'https://api.llm.christmas/v1' },
      }),
    );
    expect(out.ok).toBe(true);
    expect(out.code).not.toBe('EXTRACT_PENDING');
    expect(String(out.text || '')).toMatch(/OCR page/);
  });

  it('does not succeed when gateway extract fails and cache is only a file_read pointer', async () => {
    const pointer =
      '(content is stored server-side in the extract sidecar; to inspect it, call file_read with file_id=file-pointer-1)';
    stubGateway({
      extract: () =>
        jsonResponse(
          { code: 'EXTRACT_NOT_FOUND', message: 'No extract yet' },
          404,
        ),
      content: () => new Response('not found', { status: 404 }),
    });

    const out = await runFileRead(
      'file-pointer-1',
      makeCtx({
        fileExtracts: {
          'file-pointer-1': { name: 'report.docx', text: pointer },
        },
      }),
    );
    expect(out.ok).toBe(false);
    expect(out.code).not.toBeUndefined();
    expect(String(out.text || '')).toBe('');
  });

  it('surfaces EXTRACT_PENDING even when a non-directive cache text exists', async () => {
    vi.useFakeTimers();
    stubGateway({
      extract: () =>
        jsonResponse({
          text: '',
          chars: 0,
          partial: true,
          filename: 'report.docx',
        }),
    });

    const pending = runFileRead(
      'file-stale-cache',
      makeCtx({
        fileExtracts: {
          'file-stale-cache': {
            name: 'report.docx',
            text: '--- page 1 ---\n\nStale partial slice from an earlier poll.',
          },
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(6_000);
    const out = await pending;
    vi.useRealTimers();
    expect(out.ok).toBe(false);
    expect(out.code).toBe('EXTRACT_PENDING');
  });
});
