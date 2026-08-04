import { describe, expect, it } from 'vitest';
import {
  looksLikeMermaidSource,
  normalizeMermaidMarkdown,
  sanitizeMermaidForRender,
} from '@/lib/markdown/core/mermaid';
import { prepareChatMarkdown } from '@/lib/markdown/math';

describe('sanitizeMermaidForRender', () => {
  it('strips style/classDef/init directives and normalizes curly quotes', () => {
    const out = sanitizeMermaidForRender(`flowchart TD
  A[点击“登录”] --> B
  style A fill:#e1f5ff
  classDef foo fill:#fff
  %%{init: {'theme':'dark'}}%%
`);
    expect(out).toContain('A[点击"登录"]');
    expect(out).not.toMatch(/style\s+A/i);
    expect(out).not.toMatch(/classDef/i);
    expect(out).not.toContain('%%{init');
  });
});

describe('Mermaid Markdown recovery', () => {
  it('recognizes supported Mermaid diagram starts', () => {
    expect(looksLikeMermaidSource('flowchart TD; A-->B')).toBe(true);
    expect(looksLikeMermaidSource('sequenceDiagram\nA->>B: hello')).toBe(true);
    expect(looksLikeMermaidSource('classDiagram\nA <|-- B')).toBe(true);
    expect(looksLikeMermaidSource('flowchart is a useful format')).toBe(false);
    expect(looksLikeMermaidSource('const flowchart = true')).toBe(false);
  });

  it('promotes inline Mermaid source to a mermaid fence', () => {
    const out = normalizeMermaidMarkdown('Diagram: `flowchart TD; A-->B; B-->C`');
    expect(out).toContain('```mermaid');
    expect(out).toContain('flowchart TD; A-->B; B-->C');
  });

  it('labels a language-less Mermaid fence', () => {
    const out = normalizeMermaidMarkdown('```\nflowchart TD\n  A-->B\n```');
    expect(out).toBe('```mermaid\nflowchart TD\n  A-->B\n```');
  });

  it('does not relabel ordinary language-less code', () => {
    const md = '```\nconst x = 1;\n```';
    expect(normalizeMermaidMarkdown(md)).toBe(md);
  });

  it('runs through prepareChatMarkdown', () => {
    const out = prepareChatMarkdown('`sequenceDiagram\nA->>B: ping`');
    expect(out).toContain('```mermaid');
    expect(out).toContain('A->>B: ping');
  });
});
