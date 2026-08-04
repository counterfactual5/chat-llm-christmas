import { describe, expect, it } from 'vitest';
import {
  eastAsianCharColumns,
  eastAsianLineColumns,
} from '@/lib/markdown/core/east-asian-columns';
import { prepareChatMarkdown } from '@/lib/markdown/math';

describe('eastAsianCharColumns (ASCII art grid)', () => {
  it('treats box-drawing as 1 cell even though Unicode marks them ambiguous', () => {
    for (const ch of ['┌', '┐', '└', '┘', '│', '─', '├', '└', '═', '║']) {
      expect(eastAsianCharColumns(ch)).toBe(1);
    }
  });

  it('treats CJK / fullwidth as 2 cells', () => {
    for (const ch of ['中', '请', '求', '（', '）', '【', '】', '　']) {
      expect(eastAsianCharColumns(ch)).toBe(2);
    }
  });

  it('aligns a CJK-padded box the way East-Asian terminals do', () => {
    // Model pads assuming 中=2. Menlo renders 中≈1.66×A so raw <pre> breaks;
    // equal column counts prove the grid target the renderer enforces.
    const lines = ['┌──────────────┐', '│ 请求响应流程 │', '└──────────────┘'];
    const widths = lines.map(eastAsianLineColumns);
    expect(widths[0]).toBe(16);
    expect(new Set(widths).size).toBe(1);
  });

  it('does not change well-formed nested boxes in the markdown pipeline', () => {
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
    const out = prepareChatMarkdown(`\`\`\`text\n${nested}\n\`\`\``);
    expect(out).toContain(nested);
  });
});
