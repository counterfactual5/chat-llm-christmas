import { describe, expect, it } from 'vitest';
import {
  modelDumpsAnswerInReasoning,
  modelNeedsThinkingForTools,
  wantsThinking,
} from '@/lib/chat/server/thinking';

describe('chat thinking policy', () => {
  it('opts into thinking only for clear model name signals', () => {
    expect(wantsThinking('deepseek-r1')).toBe(true);
    expect(wantsThinking('foo-reason-bar')).toBe(true);
    expect(wantsThinking('deepseek-v4-flash')).toBe(false);
  });

  it('forces thinking for GLM tool-calling variants', () => {
    expect(modelNeedsThinkingForTools('glm-4.7')).toBe(true);
    expect(modelNeedsThinkingForTools('glm-4.6v')).toBe(false);
    expect(modelNeedsThinkingForTools('glm-5-pro')).toBe(true);
  });

  it('flags models that dump answers into reasoning fields', () => {
    expect(modelDumpsAnswerInReasoning('glm-4.7')).toBe(true);
    expect(modelDumpsAnswerInReasoning('glm-4.6')).toBe(true);
    expect(modelDumpsAnswerInReasoning('glm-4.6v')).toBe(false);
  });
});
