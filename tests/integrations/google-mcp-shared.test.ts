import { describe, expect, it } from 'vitest';
import {
  extractUiResults,
  parseArgs,
  queryHint,
  requireObjectArgs,
  toolService,
} from '@/lib/mcp/google/shared';
import { gmailToolDefs } from '@/lib/mcp/google/gmail';

describe('Google MCP shared helpers', () => {
  it('maps tool prefixes to their Google service', () => {
    expect(toolService('gmail_search')).toBe('gmail');
    expect(toolService('calendar_list_events')).toBe('calendar');
    expect(toolService('drive_upload_file')).toBe('drive');
  });

  it('parses JSON arguments and safely rejects malformed JSON', () => {
    expect(parseArgs('{"query":"invoice"}')).toEqual({ query: 'invoice' });
    // Preserve the legacy parser behavior: JSON arrays are returned as-is.
    expect(parseArgs('["not-an-object"]')).toEqual(['not-an-object']);
    expect(parseArgs('{bad json')).toEqual({});
  });

  it('requireObjectArgs refuses incomplete JSON instead of returning {}', () => {
    expect(requireObjectArgs('{"query":"invoice"}')).toEqual({ query: 'invoice' });
    expect(requireObjectArgs('')).toEqual({});
    expect(() => requireObjectArgs('{bad json')).toThrow(/Incomplete or invalid/);
    expect(() => requireObjectArgs('["not-an-object"]')).toThrow(/JSON object/);
  });

  it('builds concise tool query hints from known identifiers', () => {
    expect(queryHint('drive_get_file', { fileId: 'file-123' })).toBe('file-123');
    expect(queryHint('gmail_batch_modify', { messageIds: ['a', 'b'] })).toBe('2 messages');
    expect(queryHint('calendar_list_events', {})).toBe('calendar list events');
  });

  it('normalizes tool payload rows for the chat reference UI', () => {
    expect(
      extractUiResults('drive_search', {
        files: [
          {
            name: 'Roadmap',
            webViewLink: 'https://drive.example/roadmap',
            mimeType: 'text/plain',
          },
        ],
      }),
    ).toEqual([
      {
        title: 'Roadmap',
        url: 'https://drive.example/roadmap',
        snippet: 'text/plain',
      },
    ]);
  });
});

describe('Gmail bulk write safety latches', () => {
  const byName = Object.fromEntries(gmailToolDefs.map((d) => [d.name, d]));

  it('refuses mark_read / archive without an explicit query', async () => {
    await expect(byName.gmail_batch_mark_read.run('tok', {})).rejects.toThrow(/query is required/i);
    await expect(byName.gmail_batch_archive.run('tok', {})).rejects.toThrow(/query is required/i);
  });

  it('requires confirm=true when modify_by_query adds TRASH', async () => {
    await expect(
      byName.gmail_batch_modify_by_query.run('tok', {
        query: 'older_than:1y',
        addLabelIds: ['TRASH'],
        removeLabelIds: ['INBOX'],
      }),
    ).rejects.toThrow(/confirm=true/i);
  });
});
