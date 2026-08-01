import { describe, expect, it } from 'vitest';
import {
  isResearchCommandPrefix,
  parseResearchCommand,
} from '@/lib/chat/turn/research-command';

describe('parseResearchCommand', () => {
  it('parses /research and /研究', () => {
    expect(parseResearchCommand('/research 特斯拉 2025 Q2')).toBe('特斯拉 2025 Q2');
    expect(parseResearchCommand('/研究 AI 监管')).toBe('AI 监管');
  });

  it('returns null for unrelated text', () => {
    expect(parseResearchCommand('hello')).toBeNull();
    expect(parseResearchCommand('/image cat')).toBeNull();
    expect(parseResearchCommand('/research')).toBeNull();
  });

  it('detects bare prefix', () => {
    expect(isResearchCommandPrefix('/research')).toBe(true);
    expect(isResearchCommandPrefix('/research ')).toBe(true);
    expect(isResearchCommandPrefix('/research foo')).toBe(false);
  });
});
