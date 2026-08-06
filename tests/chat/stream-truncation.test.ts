import { describe, expect, it } from 'vitest';
import {
  actionFromStreamCode,
  streamCompletionPayload,
} from '@/lib/chat/stream/truncation';

describe('stream completion codes', () => {
  it('maps tools_timeout to Continue (truncated)', () => {
    expect(actionFromStreamCode('tools_timeout')).toMatchObject({
      truncated: true,
      preferRetry: false,
    });
    expect(streamCompletionPayload('length', { code: 'tools_timeout' })).toMatchObject({
      finish_reason: 'length',
      truncated: true,
      code: 'tools_timeout',
      truncation_reason: 'Stream timed out during tool use',
    });
  });

  it('maps upstream_error to Retry (not truncated)', () => {
    expect(actionFromStreamCode('upstream_error')).toMatchObject({
      truncated: false,
      preferRetry: true,
    });
    expect(streamCompletionPayload('error', { code: 'upstream_error' })).toMatchObject({
      finish_reason: 'error',
      truncated: false,
      code: 'upstream_error',
    });
  });

  it('attaches usage when provided', () => {
    expect(
      streamCompletionPayload('stop', {
        usage: { prompt_tokens: 1200, completion_tokens: 40, total_tokens: 1240 },
      }),
    ).toMatchObject({
      finish_reason: 'stop',
      truncated: false,
      usage: { prompt_tokens: 1200, completion_tokens: 40, total_tokens: 1240 },
    });
  });

  it('omits usage when missing', () => {
    expect(streamCompletionPayload('stop')).not.toHaveProperty('usage');
  });
});
