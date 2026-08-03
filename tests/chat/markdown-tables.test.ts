import { describe, expect, it } from 'vitest';
import {
  looksLikeCollapsedMarkdownTable,
  reflowCollapsedMarkdownTables,
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
