import { describe, expect, it } from 'vitest';
import { toApiMessages } from '@/lib/chat/message/api-messages';
import { messagePlainText } from '@/lib/chat/message/display';
import {
  TOOL_RECEIPT_BODY_CHARS,
  TOOL_RECEIPT_MAX_RESULTS,
  TOOL_RECEIPT_SNIPPET_CHARS,
  buildToolReceiptPayload,
  serializeToolReceipt,
} from '@/lib/chat/message/tool-receipt';
import type { Message } from '@/lib/chat/types';
import {
  estimateHistoryTokens,
  estimateMessageHistoryTokens,
} from '@/lib/chat/turn/history-estimate';
import { estimateTokensFromText } from '@/lib/models/specs';

function searchAssistant(body: string, content = 'Answer text'): Message {
  return {
    id: 'a1',
    role: 'assistant',
    content,
    timestamp: 1,
    toolRuns: [
      {
        id: 'tr1',
        name: 'web_search',
        status: 'done',
        query: 'cats',
        results: [
          {
            title: 'T',
            url: 'https://example.com',
            snippet: 'snip',
            ...(body ? { body } : {}),
          },
        ],
      },
    ],
  };
}

describe('tool-receipt serialize', () => {
  it('matches toApiMessages tool content for the same run', () => {
    const msg = searchAssistant('x'.repeat(1000));
    const run = msg.toolRuns![0];
    const api = toApiMessages([msg]);
    const toolMsg = api.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBe(serializeToolReceipt(run));
  });

  it('caps results, snippet, and body', () => {
    const body = 'B'.repeat(TOOL_RECEIPT_BODY_CHARS + 500);
    const snippet = 'S'.repeat(TOOL_RECEIPT_SNIPPET_CHARS + 50);
    const results = Array.from({ length: TOOL_RECEIPT_MAX_RESULTS + 1 }, (_, i) => ({
      title: `t${i}`,
      url: `https://example.com/${i}`,
      snippet,
      body,
    }));
    const payload = buildToolReceiptPayload({
      id: 'tr1',
      name: 'web_search',
      status: 'done',
      results,
    });
    const listed = payload.results as Array<{ snippet: string; content: string }>;
    expect(listed).toHaveLength(TOOL_RECEIPT_MAX_RESULTS);
    expect(listed[0].snippet).toHaveLength(TOOL_RECEIPT_SNIPPET_CHARS);
    expect(listed[0].content).toHaveLength(TOOL_RECEIPT_BODY_CHARS);
  });

  it('serializes error payloads without results', () => {
    const payload = buildToolReceiptPayload({
      id: 'tr1',
      name: 'web_search',
      status: 'done',
      query: 'q',
      error: 'boom',
      results: [{ title: 't', url: 'u', snippet: 's', body: 'ignored' }],
    });
    expect(payload).toEqual({ ok: false, error: 'boom', query: 'q' });
  });
});

describe('estimateHistoryTokens', () => {
  it('includes large tool body beyond content-only estimate', () => {
    const withBody = searchAssistant('y'.repeat(10_000));
    const contentOnly =
      estimateTokensFromText(messagePlainText(withBody)) + 4;
    const withTools = estimateHistoryTokens([withBody]);
    expect(withTools).toBeGreaterThan(contentOnly + 1000);
    const payloadTokens = estimateTokensFromText(
      serializeToolReceipt(withBody.toolRuns![0]),
    );
    expect(withTools).toBeGreaterThanOrEqual(contentOnly - 4 + payloadTokens);
  });

  it('ignores claim_reviewer and non-done runs', () => {
    const base: Message = {
      id: 'a1',
      role: 'assistant',
      content: 'Hi',
      timestamp: 1,
    };
    const withUiOnly: Message = {
      ...base,
      toolRuns: [
        {
          id: 'tr1',
          name: 'claim_reviewer',
          status: 'done',
          results: [
            {
              title: 't',
              url: 'u',
              snippet: 's',
              body: 'z'.repeat(5000),
            },
          ],
        },
      ],
    };
    const withStart: Message = {
      ...base,
      toolRuns: [
        {
          id: 'tr2',
          name: 'web_search',
          status: 'start',
          results: [
            {
              title: 't',
              url: 'u',
              snippet: 's',
              body: 'z'.repeat(5000),
            },
          ],
        },
      ],
    };
    expect(estimateMessageHistoryTokens(withUiOnly)).toBe(
      estimateTokensFromText(messagePlainText(base)),
    );
    expect(estimateMessageHistoryTokens(withStart)).toBe(
      estimateTokensFromText(messagePlainText(base)),
    );
  });

  it('counts ok/query JSON when results have no body', () => {
    const msg: Message = {
      id: 'a1',
      role: 'assistant',
      content: 'Done',
      timestamp: 1,
      toolRuns: [
        {
          id: 'tr1',
          name: 'web_search',
          status: 'done',
          query: 'q',
          results: [{ title: 't', url: 'https://x', snippet: 's' }],
        },
      ],
    };
    const plain = estimateTokensFromText(messagePlainText(msg));
    const expanded = estimateMessageHistoryTokens(msg);
    expect(expanded).toBeGreaterThan(plain);
    expect(serializeToolReceipt(msg.toolRuns![0])).not.toContain('"content"');
  });
});
