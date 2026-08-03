import { describe, expect, it } from 'vitest';
import {
  formatSourceSearchCommand,
  parseSourceSearchCommand,
} from '@/lib/chat/turn/source-search-command';
import { parseResearchCommand } from '@/lib/chat/turn/research-command';

describe('parseSourceSearchCommand', () => {
  it('parses /news and aliases', () => {
    expect(parseSourceSearchCommand('/news OpenAI funding')).toEqual({
      kind: 'news',
      query: 'OpenAI funding',
    });
    expect(parseSourceSearchCommand('/新闻 AI 芯片')).toEqual({
      kind: 'news',
      query: 'AI 芯片',
    });
  });

  it('parses /wiki with optional lang', () => {
    expect(parseSourceSearchCommand('/wiki Quantum computing')).toEqual({
      kind: 'wiki',
      query: 'Quantum computing',
    });
    expect(parseSourceSearchCommand('/wiki zh 量子计算')).toEqual({
      kind: 'wiki',
      query: '量子计算',
      lang: 'zh',
    });
    expect(parseSourceSearchCommand('/百科 相对论')).toEqual({
      kind: 'wiki',
      query: '相对论',
    });
  });

  it('formats commands', () => {
    expect(formatSourceSearchCommand('news', 'x')).toBe('/news x');
    expect(formatSourceSearchCommand('wiki', 'x', { lang: 'zh' })).toBe(
      '/wiki zh x',
    );
  });
});

describe('research sources news/wiki', () => {
  it('parses research source lanes', () => {
    expect(parseResearchCommand('/research news OpenAI')).toEqual({
      query: 'OpenAI',
      sources: 'news',
    });
    expect(parseResearchCommand('/research rigorous wiki 量子计算')).toEqual({
      query: '量子计算',
      mode: 'rigorous',
      sources: 'wiki',
    });
  });
});
