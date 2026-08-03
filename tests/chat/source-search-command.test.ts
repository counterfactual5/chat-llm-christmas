import { describe, expect, it } from 'vitest';
import {
  formatSourceSearchCommand,
  parseSourceSearchCommand,
} from '@/lib/chat/turn/source-search-command';
import { parseResearchCommand } from '@/lib/chat/turn/research-command';
import {
  formatSourceSearchMarkdown,
  buildSourceSearchPolishPrompt,
  sanitizeSourceSearchPolish,
} from '@/lib/chat/turn/source-search';

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
  it('folds news/wiki research tokens into mixed', () => {
    expect(parseResearchCommand('/research news OpenAI')).toEqual({
      query: 'OpenAI',
      sources: 'mixed',
    });
    expect(parseResearchCommand('/research rigorous wiki 量子计算')).toEqual({
      query: '量子计算',
      mode: 'rigorous',
      sources: 'mixed',
    });
  });
});

describe('formatSourceSearchMarkdown', () => {
  it('soft-fails empty hits with tips instead of raw provider dump only', () => {
    const text = formatSourceSearchMarkdown(
      'wiki',
      {
        provider: 'none',
        query: '能查询什么',
        results: [],
        error: 'wikipedia_zh: no results',
      },
      '能查询什么',
    );
    expect(text).toContain('没有找到');
    expect(text).toContain('实体词条');
    expect(text).not.toContain('search failed');
  });

  it('renders human-readable linked hits and strips HTML snippets', () => {
    const text = formatSourceSearchMarkdown(
      'news',
      {
        provider: 'google_news_zh',
        query: '值得关注',
        results: [
          {
            title: '谷歌眼镜即将回归',
            url: 'https://news.google.com/rss/articles/x',
            snippet:
              '<a href="https://example.com/">快科技</a><font color="#6f6f6f">报道称眼镜将回归。</font>',
            publishedAt: '2026-08-01',
          },
        ],
      },
      '有什么值得关注的消息吗',
    );
    expect(text).toContain('### News');
    expect(text).toContain('[谷歌眼镜即将回归](https://news.google.com/rss/articles/x)');
    expect(text).toContain('快科技 报道称眼镜将回归');
    expect(text).not.toContain('<a href');
    expect(text).not.toContain('"ok":true');
    expect(text).not.toContain('instructions');
  });
});

describe('buildSourceSearchPolishPrompt', () => {
  it('asks for a readable briefing without embedding tool JSON envelopes', () => {
    const prompt = buildSourceSearchPolishPrompt(
      'news',
      '有什么值得关注的消息吗',
      {
        provider: 'google_news_zh',
        query: '有什么值得关注的消息吗',
        results: [
          {
            title: '谷歌眼镜即将回归',
            url: 'https://example.com/a',
            snippet: '<a href="x">快科技</a>报道',
          },
        ],
      },
    );
    expect(prompt).toContain('news briefing');
    expect(prompt).toContain('Never reprint');
    expect(prompt).toContain('谷歌眼镜即将回归');
    expect(prompt).toContain('快科技 报道');
    expect(prompt).not.toContain('"ok":true');
    expect(prompt).not.toContain('"instructions"');
    expect(prompt).not.toContain('<a href');
  });
});

describe('sanitizeSourceSearchPolish', () => {
  it('strips leaked tool JSON after a short briefing', () => {
    const cleaned = sanitizeSourceSearchPolish(
      [
        '## 要点',
        '- [谷歌眼镜](https://example.com) 即将回归',
        '',
        '{"ok":true,"asOf":"2026-08-03","results":[{"rank":1}],"instructions":"x"}',
      ].join('\n'),
    );
    expect(cleaned).toContain('谷歌眼镜');
    expect(cleaned).not.toContain('"ok":true');
  });

  it('rejects replies that are mostly the tool envelope', () => {
    expect(
      sanitizeSourceSearchPolish(
        '{"ok":true,"results":[{"title":"a"}],"instructions":"cite links"}',
      ),
    ).toBeNull();
  });
});
