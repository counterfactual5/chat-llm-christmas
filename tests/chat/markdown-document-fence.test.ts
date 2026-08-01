import { describe, expect, it } from 'vitest';
import { unwrapMarkdownDocumentFence } from '@/lib/markdown/document-fence';

describe('unwrapMarkdownDocumentFence', () => {
  it('unwraps a whole fenced Markdown document', () => {
    expect(
      unwrapMarkdownDocumentFence('```markdown\n# Skill\n\n- First\n- Second\n```'),
    ).toBe('# Skill\n\n- First\n- Second');
  });

  it('keeps embedded and non-document fences unchanged', () => {
    const embedded = 'Intro\n\n```markdown\n# Example\n```\n\nOutro';
    expect(unwrapMarkdownDocumentFence(embedded)).toBe(embedded);

    const snippet = '```markdown\nplain text only\n```';
    expect(unwrapMarkdownDocumentFence(snippet)).toBe(snippet);
  });
});
