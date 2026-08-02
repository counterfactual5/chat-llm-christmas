import { describe, expect, it } from 'vitest';
import {
  formatResearchCommand,
  isResearchCommandPrefix,
  parseResearchCommand,
} from '@/lib/chat/turn/research-command';

describe('parseResearchCommand', () => {
  it('parses /research and /研究 into a query object', () => {
    expect(parseResearchCommand('/research 特斯拉 2025 Q2')).toEqual({
      query: '特斯拉 2025 Q2',
    });
    expect(parseResearchCommand('/研究 AI 监管')).toEqual({ query: 'AI 监管' });
  });

  it('parses English and Chinese research-depth aliases', () => {
    expect(parseResearchCommand('/research quick AI regulation')).toEqual({
      query: 'AI regulation',
      mode: 'quick',
    });
    expect(parseResearchCommand('/研究 严谨 AI 监管')).toEqual({
      query: 'AI 监管',
      mode: 'rigorous',
    });
  });

  it('parses optional literature / mixed source lane after depth', () => {
    expect(parseResearchCommand('/research rigorous literature GLP-1 outcomes')).toEqual({
      query: 'GLP-1 outcomes',
      mode: 'rigorous',
      sources: 'literature',
    });
    expect(parseResearchCommand('/research quick web 特斯拉')).toEqual({
      query: '特斯拉',
      mode: 'quick',
      sources: 'web',
    });
    expect(parseResearchCommand('/research standard mixed 注意力机制')).toEqual({
      query: '注意力机制',
      mode: 'standard',
      sources: 'mixed',
    });
  });

  it('formats depth and source in the visible command', () => {
    expect(formatResearchCommand('AI', 'standard', 'literature')).toBe(
      '/research standard literature AI',
    );
    expect(formatResearchCommand('AI')).toBe('/research AI');
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
