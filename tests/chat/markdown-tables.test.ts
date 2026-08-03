import { describe, expect, it } from 'vitest';
import {
  looksLikeCollapsedMarkdownTable,
  reflowCollapsedMarkdownTables,
  repairGfmTableStructure,
} from '@/lib/markdown/core/tables';
import { prepareChatMarkdown } from '@/lib/markdown/math';

describe('reflowCollapsedMarkdownTables', () => {
  it('detects smashed header+sep+rows on one line', () => {
    const smashed =
      '| 平台 | 状态 | 说明 | |------|------|------| | 登链 | ❌ 已售 | GoDaddy | | Dework | ❌ 已售 | GoDaddy |';
    expect(looksLikeCollapsedMarkdownTable(smashed)).toBe(true);
    const out = reflowCollapsedMarkdownTables(smashed);
    expect(out).toContain('|------|------|------|');
    expect(out.split('\n').length).toBeGreaterThanOrEqual(4);
    expect(out).toMatch(/\|\s*平台\s*\|\s*状态/);
    expect(out).toMatch(/\n\|\s*登链/);
  });

  it('leaves already-valid tables alone', () => {
    const ok = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    expect(reflowCollapsedMarkdownTables(ok)).toBe(ok);
  });

  it('runs through prepareChatMarkdown', () => {
    const smashed =
      '前言\n\n| 平台 | 状态 | |------|------| | A | ok |\n\n后记';
    const out = prepareChatMarkdown(smashed);
    expect(out).toMatch(/\|\s*平台[^\n]*\|\s*\n\|\s*-+/);
  });
});

describe('repairGfmTableStructure', () => {
  it('peels a prose title jammed onto the header when sep follows', () => {
    const raw = [
      '⚠️ 已经失效/关停的平台（不要浪费时间） | 平台 | 状态 | 说明 |',
      '|------|------|------|',
      '| 登链社区主站 (dengchain.com) | ❌ 域名已售卖 | 已被 GoDaddy 挂售 |',
      '| **Dework** (dework.com) | ❌ 域名已售卖 | 已被 GoDaddy 挂售 |',
      '| **Gitcoin** 旧版 Bounties | ❌ 已迁移 | 任务现在分散在 Grants 和各项目 GitHub | |',
      '**Web3.career** 中文版 | ⚠️ 不确定 | 主站还在，但中文服务可能已缩减 | ---',
      '🎯 针对你的 **Solidity** 开发背景，最实际的 3 条路径',
    ].join('\n');

    const out = prepareChatMarkdown(raw);
    expect(out).toMatch(/^⚠️ 已经失效\/关停的平台（不要浪费时间）\n\n\| 平台 \|/);
    expect(out).toContain('| 平台 | 状态 | 说明 |');
    expect(out).toContain('|------|------|------|');
    expect(out).toContain(
      '| **Web3.career** 中文版 | ⚠️ 不确定 | 主站还在，但中文服务可能已缩减 |',
    );
    expect(out).toMatch(/\|\n\n---\n\n🎯/);
    expect(out).not.toMatch(/不要浪费时间） \| 平台/);
  });

  it('normalizes fullwidth pipes', () => {
    const raw = '标题｜平台｜状态｜\n｜---｜---｜---｜\n｜a｜b｜c｜';
    const out = repairGfmTableStructure(raw);
    expect(out).toContain('|');
    expect(out).not.toContain('｜');
  });
});
