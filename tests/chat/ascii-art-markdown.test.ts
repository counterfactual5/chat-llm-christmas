import { describe, expect, it } from 'vitest';
import {
  looksLikeAsciiTree,
  promoteInlineAsciiArtToFences,
  reflowCollapsedAsciiTree,
} from '@/lib/markdown/core/ascii-art';
import { prepareChatMarkdown } from '@/lib/markdown/math';

describe('ascii tree markdown recovery', () => {
  const flatTree =
    'AI架构师 (总设计师) ├─ 决定是否需要 Agent ├─ 规划技术方案 └─ 选择模型和工具 AI Agent工程师 (实现者) ├─ 构建 Agent ├─ 编写 Prompt └─ 工具集成';

  it('detects branch markers', () => {
    expect(looksLikeAsciiTree(flatTree)).toBe(true);
    expect(looksLikeAsciiTree('plain text')).toBe(false);
    expect(looksLikeAsciiTree('`code` only')).toBe(false);
  });

  it('reflows a flattened tree into multiple lines', () => {
    const out = reflowCollapsedAsciiTree(flatTree);
    expect(out).toContain('\n├─ 决定是否需要 Agent');
    expect(out).toContain('\n└─ 选择模型和工具');
    expect(out).toContain('\nAI Agent工程师 (实现者)');
    expect(out).toContain('\n├─ 构建 Agent');
  });

  it('promotes inline backtick trees to fenced text blocks', () => {
    const md = `### 三个岗位的区别\n\n\`${flatTree}\``;
    const out = promoteInlineAsciiArtToFences(md);
    expect(out).toContain('```text');
    expect(out).toContain('├─ 决定是否需要 Agent');
    expect(out).not.toMatch(/`AI架构师/);
  });

  it('keeps a tiny single-branch mention inline', () => {
    const md = 'See the child node `├─ only one` in passing.';
    expect(promoteInlineAsciiArtToFences(md)).toBe(md);
  });

  it('runs through prepareChatMarkdown before remark can collapse newlines', () => {
    const md = '标题\n\n`Root\n├─ a\n└─ b`';
    const out = prepareChatMarkdown(md);
    expect(out).toContain('```text');
    expect(out).toContain('├─ a');
    expect(out).toContain('└─ b');
  });
});
