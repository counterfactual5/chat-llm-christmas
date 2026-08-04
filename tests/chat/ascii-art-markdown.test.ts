import { describe, expect, it } from 'vitest';
import {
  looksLikeAsciiArt,
  looksLikeAsciiTree,
  normalizeAsciiArtMarkdown,
  promoteInlineAsciiArtToFences,
  reflowCollapsedAsciiArt,
} from '@/lib/markdown/core/ascii-art';
import { prepareChatMarkdown } from '@/lib/markdown/math';

describe('ASCII art Markdown recovery', () => {
  const flatTree =
    'AI架构师 (总设计师) ├─ 决定是否需要 Agent ├─ 规划技术方案 └─ 选择模型和工具 AI Agent工程师 (实现者) ├─ 构建 Agent ├─ 编写 Prompt └─ 工具集成';

  it('detects Unicode and portable ASCII trees', () => {
    expect(looksLikeAsciiTree(flatTree)).toBe(true);
    expect(looksLikeAsciiTree('Root +-- child \\-- leaf')).toBe(true);
    expect(looksLikeAsciiTree('Root |-- child `-- leaf')).toBe(true);
    expect(looksLikeAsciiTree('plain text')).toBe(false);
  });

  it('reflows a flattened Unicode tree into multiple lines', () => {
    const out = reflowCollapsedAsciiArt(flatTree);
    expect(out).toContain('\n├─ 决定是否需要 Agent');
    expect(out).toContain('\n└─ 选择模型和工具');
    expect(out).toContain('\nAI Agent工程师 (实现者)');
  });

  it('promotes inline backtick Unicode trees to fenced text blocks', () => {
    const out = promoteInlineAsciiArtToFences(`### 区别\n\n\`${flatTree}\``);
    expect(out).toContain('```text');
    expect(out).toContain('├─ 决定是否需要 Agent');
  });

  it('promotes plain portable trees before literal backticks corrupt parsing', () => {
    const md = 'app\n|-- src\n|   `-- main.ts\n`-- README.md';
    const out = normalizeAsciiArtMarkdown(md);
    expect(out).toContain('```text');
    expect(out).toContain('`-- main.ts');
    expect(out).toContain('`-- README.md');
  });

  it('recovers double-line and rounded Unicode boxes', () => {
    for (const box of [
      '╔════╗ ║ App ║ ╚════╝',
      '╭────╮ │ App │ ╰────╯',
      '┌────┐ │ App │ └────┘',
    ]) {
      expect(looksLikeAsciiArt(box)).toBe(true);
      const out = normalizeAsciiArtMarkdown(`\`${box}\``);
      expect(out).toContain('```text');
      expect(out).toContain('\n');
    }
  });

  it('keeps tiny one-branch mentions and normal inline code untouched', () => {
    expect(promoteInlineAsciiArtToFences('See `├─ only one` in passing.')).toBe(
      'See `├─ only one` in passing.',
    );
    expect(normalizeAsciiArtMarkdown('Use `npm test` now.')).toBe('Use `npm test` now.');
  });

  it('runs through prepareChatMarkdown before remark can collapse newlines', () => {
    const out = prepareChatMarkdown('标题\n\n`Root\n├─ a\n└─ b`');
    expect(out).toContain('```text');
    expect(out).toContain('├─ a');
    expect(out).toContain('└─ b');
  });

  it('reflows flattened ASCII already inside a ```text fence', () => {
    const flatBox = '┌────┐ │ App │ └────┘';
    const md = `## 盒模型\n\n\`\`\`text\n${flatBox}\n\`\`\`\n`;
    const out = normalizeAsciiArtMarkdown(md);
    expect(out).toContain('```text');
    expect(out).toContain('\n│ App │\n');
    // Real code fences must stay untouched.
    const code = '```js\nconst x = "┌────┐ │ App │ └────┘";\n```';
    expect(normalizeAsciiArtMarkdown(code)).toBe(code);
  });

  it('reflows half-flattened Unicode boxes that already contain some newlines', () => {
    const half = '┌────┐\n│ App │ └────┘';
    const out = reflowCollapsedAsciiArt(half);
    expect(out).toContain('\n│ App │\n');
    expect(out).toContain('└────┘');
  });

  it('does not shred a nested multi-line CSS box model', () => {
    const nested = [
      '┌─────────────────────────┐',
      '│         Margin          │',
      '│  ┌───────────────────┐  │',
      '│  │      Border       │  │',
      '│  │  ┌─────────────┐  │  │',
      '│  │  │   Padding   │  │  │',
      '│  │  │  ┌───────┐  │  │  │',
      '│  │  │  │Content│  │  │  │',
      '│  │  │  └───────┘  │  │  │',
      '│  │  └─────────────┘  │  │',
      '│  └───────────────────┘  │',
      '└─────────────────────────┘',
    ].join('\n');
    expect(reflowCollapsedAsciiArt(nested)).toBe(nested);
    const fenced = normalizeAsciiArtMarkdown(`\`\`\`text\n${nested}\n\`\`\``);
    expect(fenced).toContain('│  │      Border       │  │');
    expect(fenced).not.toMatch(/│\n│\n│/);
  });

  it('does not reflow weak bare fences that only mention a few box chars', () => {
    const md = 'Example glyph: ```\nsee ┌ here\n```\n';
    expect(normalizeAsciiArtMarkdown(md)).toBe(md);
  });

  it('still reflows a strong Unicode box inside a bare fence', () => {
    const md = '```\n┌────┐ │ App │ └────┘\n```';
    const out = normalizeAsciiArtMarkdown(md);
    expect(out).toContain('\n│ App │\n');
  });
});
