import { describe, expect, it } from 'vitest';
import {
  compactQuoteMath,
  countDisplayMathDelimiters,
  escapeCurrencyDollars,
  escapeIncompleteBlockMath,
  escapeIncompleteInlineMath,
  fixFlankingEmphasis,
  hasUnclosedDisplayMath,
  liftQuotedMathBlocks,
  looksLikeTruncatedMath,
  normalizeMathDelimiters,
  prepareChatMarkdown,
} from '@/lib/markdown/math';

describe('normalizeMathDelimiters', () => {
  it('converts \\[...\\] and \\(...\\) into $$ / $', () => {
    expect(normalizeMathDelimiters('\\[x^2\\]')).toBe('\n$$\nx^2\n$$\n');
    expect(normalizeMathDelimiters('\\(x^2\\)')).toBe('$x^2$');
  });

  it('wraps bare \\begin{aligned}…\\end{aligned} in $$', () => {
    const input = '\\begin{aligned}a&=b\\end{aligned}';
    expect(normalizeMathDelimiters(input)).toBe(`\n$$\n${input}\n$$\n`);
  });

  it('leaves fenced code blocks untouched', () => {
    const code = '```js\nconst x = "\\(not math\\)";\n```';
    expect(normalizeMathDelimiters(code)).toBe(code);
  });
});

describe('liftQuotedMathBlocks', () => {
  it('lifts a blockquote that is only display math out of the quote', () => {
    expect(liftQuotedMathBlocks('> $$\n> x^2\n> $$')).toBe('$$\nx^2\n$$');
  });

  it('leaves a blockquote with prose untouched', () => {
    const input = '> hello world';
    expect(liftQuotedMathBlocks(input)).toBe(input);
  });
});

describe('countDisplayMathDelimiters / hasUnclosedDisplayMath', () => {
  it('ignores $$ inside fenced or inline code', () => {
    expect(countDisplayMathDelimiters('`$$` and ```\n$$\n```')).toBe(0);
  });

  it('detects an odd number of $$ as unclosed', () => {
    expect(hasUnclosedDisplayMath('$$x^2')).toBe(true);
    expect(hasUnclosedDisplayMath('$$x^2$$')).toBe(false);
  });
});

describe('looksLikeTruncatedMath', () => {
  it('flags a dangling backslash command as truncated', () => {
    expect(looksLikeTruncatedMath('$$x = \\frac')).toBe(true);
  });

  it('does not flag closed math', () => {
    expect(looksLikeTruncatedMath('$$x^2$$')).toBe(false);
  });

  it('does not flag prose that merely mentions $$', () => {
    expect(looksLikeTruncatedMath('同一个 $$ 块里用 \\quad 隔开，对吗？')).toBe(false);
  });
});

describe('escapeIncompleteBlockMath', () => {
  it('escapes a trailing unclosed $$ block', () => {
    expect(escapeIncompleteBlockMath('text $$x^2')).toBe('text \\$\\$x^2');
  });

  it('leaves fully closed $$ blocks untouched', () => {
    expect(escapeIncompleteBlockMath('$$x^2$$')).toBe('$$x^2$$');
  });
});

describe('escapeIncompleteInlineMath', () => {
  it('escapes a lone trailing $ (odd count → unclosed)', () => {
    expect(escapeIncompleteInlineMath('price is $5')).toBe('price is \\$5');
  });

  it('leaves an even count of $ untouched (assumed balanced $…$)', () => {
    expect(escapeIncompleteInlineMath('is $x$ true')).toBe('is $x$ true');
  });

  it('leaves closed $$ blocks untouched', () => {
    expect(escapeIncompleteInlineMath('$$x^2$$')).toBe('$$x^2$$');
  });
});

describe('fixFlankingEmphasis', () => {
  it('moves CJK quotes outside of ** markers', () => {
    expect(fixFlankingEmphasis('**“text”**')).toBe('“**text**”');
  });

  it('moves trailing punctuation outside the closing **', () => {
    expect(fixFlankingEmphasis('**更正引用：**文中')).toBe('**更正引用**：文中');
  });

  it('moves a leading currency symbol before the opening **', () => {
    expect(fixFlankingEmphasis('约**$2,160**')).toBe('约$**2,160**');
  });
});

describe('escapeCurrencyDollars', () => {
  it('escapes $ immediately before a digit outside $$ blocks', () => {
    expect(escapeCurrencyDollars('costs $64,000 total')).toBe('costs \\$64,000 total');
  });

  it('leaves $$ math blocks untouched', () => {
    expect(escapeCurrencyDollars('$$5 + 5$$')).toBe('$$5 + 5$$');
  });
});

describe('compactQuoteMath', () => {
  it('shrinks a lone $$…$$ formula into inline $…$', () => {
    expect(compactQuoteMath('$$\nx^2\n$$')).toBe('$x^2$');
  });

  it('keeps \\begin{…} display blocks as a $$ display block, not inline', () => {
    const input = '$$\n\\begin{aligned}a&=b\\end{aligned}\n$$';
    expect(compactQuoteMath(input)).toBe(
      '\n$$\n\\begin{aligned}a&=b\\end{aligned}\n$$\n',
    );
  });
});

describe('prepareChatMarkdown', () => {
  it('normalizes delimiters and escapes currency for a finished message', () => {
    expect(prepareChatMarkdown('\\(x^2\\) costs $5')).toBe('$x^2$ costs \\$5');
  });

  it('escapes currency-looking $ while streaming (no bare $ left for KaTeX)', () => {
    const input = 'value is $5 and $10';
    expect(prepareChatMarkdown(input, { streaming: true })).toBe(
      'value is \\$5 and \\$10',
    );
  });
});
