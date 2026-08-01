import { describe, expect, it } from 'vitest';
import { formatUnknownError } from '@/lib/tools/zhipu/mcp-helpers';

describe('formatUnknownError', () => {
  it('prefers Error.message', () => {
    expect(formatUnknownError(new Error('boom'))).toBe('boom');
  });

  it('unwraps nested error objects instead of [object Object]', () => {
    expect(formatUnknownError({ error: { message: 'MCP AUTH_ERROR' } })).toBe('MCP AUTH_ERROR');
    expect(formatUnknownError({ message: 'plain' })).toBe('plain');
  });

  it('stringifies plain objects as JSON when needed', () => {
    const text = formatUnknownError({ code: 401, reason: 'denied' });
    expect(text).toContain('401');
    expect(text).not.toBe('[object Object]');
  });
});
