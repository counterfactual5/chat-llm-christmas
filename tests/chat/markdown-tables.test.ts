import { describe, expect, it } from 'vitest';
import {
  breakInlineCellBullets,
  insertMissingTableSeparator,
  looksLikeCollapsedMarkdownTable,
  reflowCollapsedMarkdownTables,
  reflowInlineListsInTableCells,
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

  it('restores a delimiter row the model forgot', () => {
    const out = insertMissingTableSeparator(
      [
        '| 库名称 | 主要功能 | 学习难度 |',
        '| NumPy | 数值计算与多维数组 | 中等 |',
        '| Pandas | 数据处理与分析 | 中等 |',
        '| Matplotlib | 数据可视化 | 较低 |',
      ].join('\n'),
    );
    const lines = out.split('\n');
    expect(lines[1]).toBe('| --- | --- | --- |');
    expect(lines).toHaveLength(5);
    expect(lines[2]).toContain('NumPy');
  });

  it('does not touch table bodies, short runs, or fenced examples', () => {
    const valid = ['| a | b |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'].join('\n');
    expect(insertMissingTableSeparator(valid)).toBe(valid);

    const twoRows = ['| a | b |', '| 1 | 2 |'].join('\n');
    expect(insertMissingTableSeparator(twoRows)).toBe(twoRows);

    const fenced = ['```md', '| a | b |', '| 1 | 2 |', '| 3 | 4 |', '```'].join('\n');
    expect(prepareChatMarkdown(fenced)).toContain(fenced);
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

  it('peels a jammed title even when a blank line precedes the separator', () => {
    const raw = [
      '第二步：区分 nvidia vs nvidia_cu126 | 情况 | 推荐选择 | 原因 |',
      '',
      '|------|---------|------|',
      '| 已经有 NVIDIA 驱动/CUDA | `nvidia` | 体积更小 |',
      '| 没装 CUDA / 不想折腾 | `nvidia_cu126` | 开箱即用 |',
    ].join('\n');
    const out = prepareChatMarkdown(raw);
    expect(out).toMatch(/^第二步：区分 nvidia vs nvidia_cu126\n\n\| 情况 \|/);
    expect(out).not.toMatch(/nvidia_cu126 \| 情况/);
    expect(out).toContain('|------|---------|------|');
  });

  it('normalizes unicode dashes inside separator rows', () => {
    const raw = [
      '第二步：区分版本 | 情况 | 推荐 | 原因 |',
      '|──────|─────────|──────|',
      '| 已装 CUDA | cu126 | 快 |',
    ].join('\n');
    const out = prepareChatMarkdown(raw);
    expect(out).toMatch(/^第二步：区分版本\n\n\| 情况 \|/);
    expect(out).toContain('|------|---------|------|');
    expect(out).not.toMatch(/[─━═]/);
  });

  it('inserts an empty header when the model emits only sep + body rows', () => {
    const raw = [
      '### 第二步：区分 nvidia vs nvidia_cu126',
      '|------|---------|------|',
      '| 已经有 NVIDIA 驱动/CUDA | `nvidia` | 体积更小 |',
      '| 没装 CUDA / 不想折腾 | `nvidia_cu126` | 开箱即用 |',
    ].join('\n');
    const out = prepareChatMarkdown(raw);
    expect(out).toContain('| - | - | - |');
    expect(out).toContain('|------|---------|------|');
    expect(out).toContain('| 已经有 NVIDIA 驱动/CUDA | `nvidia` | 体积更小 |');
  });

  it('does not insert a placeholder header before a valid pipe header without leading |', () => {
    const raw = [
      'Very long column name here | Col2 | Col3 | Col4 |',
      '|------|------|------|------|',
      '| a | b | c | d |',
    ].join('\n');
    const out = prepareChatMarkdown(raw);
    expect(out).not.toContain('| - | - | - | - |');
    expect(out).toContain('Very long column name here | Col2 | Col3 | Col4 |');
    expect(out).toContain('|------|------|------|------|');
    expect(out).toContain('| a | b | c | d |');
  });
});

describe('breakInlineCellBullets', () => {
  it('splits jammed • lists onto <br> lines', () => {
    expect(
      breakInlineCellBullets(
        '例如：• “大家想不想一起做一个小型区块链项目？” • “我在读一个关于 NFT 的课程，想分享一下。”',
      ),
    ).toBe(
      '例如：<br>• “大家想不想一起做一个小型区块链项目？”<br>• “我在读一个关于 NFT 的课程，想分享一下。”',
    );
  });

  it('runs through prepareChatMarkdown on a full table', () => {
    const raw = [
      '| 方向 | 做法 |',
      '| --- | --- |',
      '| 技术社团 | 例如：• **Code for Monash** (软件开发) • **Monash Data Science Club** |',
    ].join('\n');
    const out = prepareChatMarkdown(raw);
    expect(out).toContain('例如：<br>• **Code for Monash**');
    expect(out).toContain('<br>• **Monash Data Science Club**');
    expect(reflowInlineListsInTableCells(raw)).toContain('<br>•');
  });
});
