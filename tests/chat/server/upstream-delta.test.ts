import { describe, expect, it } from 'vitest';
import { splitCompletionDelta } from '@/lib/chat/server/upstream';

describe('splitCompletionDelta', () => {
  it('does not stutter when the gateway mirrors the same thinking on multiple fields', () => {
    const { reasoning, content } = splitCompletionDelta(
      {
        reasoning_content: 'The user wants a briefing',
        reasoning: 'The user wants a briefing',
        thinking: 'The user wants a briefing',
      },
      { reasoningAsContent: false },
    );
    expect(reasoning).toBe('The user wants a briefing');
    expect(content).toBe('');
  });

  it('prefers reasoning_content over later aliases', () => {
    const { reasoning } = splitCompletionDelta(
      {
        reasoning_content: 'first',
        reasoning: 'second',
      },
      { reasoningAsContent: false },
    );
    expect(reasoning).toBe('first');
  });

  it('keeps content separate from reasoning', () => {
    const { reasoning, content } = splitCompletionDelta(
      {
        content: 'hello',
        reasoning_content: 'plan',
      },
      { reasoningAsContent: false },
    );
    expect(content).toBe('hello');
    expect(reasoning).toBe('plan');
  });
});
