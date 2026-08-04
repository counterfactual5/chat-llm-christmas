import { describe, expect, it } from 'vitest';
import { activeIntegrationsPrompt } from '@/lib/models/specs/prompts';

describe('activeIntegrationsPrompt', () => {
  it('makes GitHub MCP the primary path for GitHub resources', () => {
    const text = activeIntegrationsPrompt({
      searchEnabled: true,
      integrations: ['github'],
    });

    expect(text).toContain('GitHub MCP: ON');
  });

  it('reports opt-in paper/book/image tools as OFF by default', () => {
    const text = activeIntegrationsPrompt({
      searchEnabled: true,
      integrations: [],
    });
    expect(text).toContain('paper_search: OFF');
    expect(text).toContain('book_search: OFF');
    expect(text).toContain('generate_image: OFF');
  });

  it('reports opt-in paper/book/image tools as ON when enabled', () => {
    const text = activeIntegrationsPrompt({
      searchEnabled: true,
      integrations: ['paper_search', 'book_search', 'generate_image'],
    });
    expect(text).toContain('paper_search: ON');
    expect(text).toContain('book_search: ON');
    expect(text).toContain('generate_image: ON');
  });

  it('warns when Notion/GitHub/Google are toggled without OAuth', () => {
    const text = activeIntegrationsPrompt({
      searchEnabled: false,
      integrations: [],
      googleRequestedButUnauthorized: true,
      notionRequestedButUnauthorized: true,
      githubRequestedButUnauthorized: true,
    });
    expect(text).toMatch(/Google toggled but no usable OAuth/i);
    expect(text).toMatch(/Notion toggled but no usable OAuth/i);
    expect(text).toMatch(/GitHub toggled but no usable OAuth/i);
  });
});
