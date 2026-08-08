import { describe, expect, it, vi } from 'vitest';
import {
  parseOfficeWriteArgs,
  parseOfficeRollbackArgs,
  createOfficeWriteTool,
} from '@/lib/tools/office-write/tool';

describe('office_write parse', () => {
  it('requires file_id and non-empty ops', () => {
    expect(parseOfficeWriteArgs('{}').error).toMatch(/file_id/);
    expect(
      parseOfficeWriteArgs(JSON.stringify({ file_id: 'file-abc', ops: [] })).error,
    ).toMatch(/ops/);
  });

  it('accepts valid ops', () => {
    const parsed = parseOfficeWriteArgs(
      JSON.stringify({
        file_id: 'file-abc123',
        ops: [{ op: 'replace_text', find: 'a', replace: 'b' }],
      }),
    );
    expect(parsed.error).toBeUndefined();
    expect(parsed.fileId).toBe('file-abc123');
    expect(parsed.ops).toHaveLength(1);
  });

  it('rejects too many ops', () => {
    const ops = Array.from({ length: 51 }, () => ({
      op: 'replace_text',
      find: 'a',
      replace: 'b',
    }));
    expect(
      parseOfficeWriteArgs(JSON.stringify({ file_id: 'file-x', ops })).error,
    ).toMatch(/at most/);
  });
  it('rejects full_replace without confirm', () => {
    expect(
      parseOfficeWriteArgs(
        JSON.stringify({
          file_id: 'file-abc',
          ops: [{ op: 'full_replace', content_base64: 'QQ==' }],
        }),
      ).error,
    ).toMatch(/confirm_full_replace/);
  });

  it('accepts full_replace with confirm', () => {
    const parsed = parseOfficeWriteArgs(
      JSON.stringify({
        file_id: 'file-abc',
        confirm_full_replace: true,
        ops: [{ op: 'full_replace', content_base64: 'QQ==' }],
      }),
    );
    expect(parsed.error).toBeUndefined();
  });
});

describe('office_rollback parse', () => {
  it('requires snapshot_id', () => {
    expect(
      parseOfficeRollbackArgs(JSON.stringify({ file_id: 'file-x' })).error,
    ).toMatch(/snapshot_id/);
  });
});

describe('office_write execute', () => {
  it('denies guest without skillsApiKey', async () => {
    const tool = createOfficeWriteTool();
    const send = vi.fn();
    const out = await tool.execute(
      {
        callId: 'c1',
        rawArguments: JSON.stringify({
          file_id: 'file-abc',
          ops: [{ op: 'replace_text', find: 'a', replace: 'b' }],
        }),
        fallbackQuery: '',
      },
      {
        userAsk: 'edit',
        send,
        gateway: { apiKey: 'sk-shared', baseURL: 'https://example' },
      },
    );
    const body = JSON.parse(out.content);
    expect(body.ok).toBe(false);
    expect(String(body.error)).toMatch(/connected account/i);
  });

  it('rejects file_id outside thread fileExtracts when present', async () => {
    const tool = createOfficeWriteTool();
    const send = vi.fn();
    const out = await tool.execute(
      {
        callId: 'c2',
        rawArguments: JSON.stringify({
          file_id: 'file-other',
          ops: [{ op: 'replace_text', find: 'a', replace: 'b' }],
        }),
        fallbackQuery: '',
      },
      {
        userAsk: 'edit',
        send,
        credentials: { skillsApiKey: 'sk-user' },
        fileExtracts: { 'file-known': { text: 'hello' } },
      },
    );
    const body = JSON.parse(out.content);
    expect(body.ok).toBe(false);
    expect(String(body.error)).toMatch(/not in this thread/i);
  });
});
