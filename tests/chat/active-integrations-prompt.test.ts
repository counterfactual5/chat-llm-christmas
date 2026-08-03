import { describe, expect, it } from 'vitest';
import { activeIntegrationsPrompt } from '@/lib/models/specs/prompts';

describe('activeIntegrationsPrompt', () => {
  it('makes GitHub MCP the primary path for GitHub resources', () => {
    const text = activeIntegrationsPrompt({
      searchEnabled: true,
      integrations: ['github'],
    });

    expect(text).toContain('GitHub MCP: ON');
    expect(text).toContain('use it first for github.com repositories');
    expect(text).toContain('generic web tools are fallback only');
  });

  it('reports paper/book as command-only and image toggle OFF by default', () => {
    const text = activeIntegrationsPrompt({
      searchEnabled: true,
      integrations: [],
    });
    expect(text).toContain('paper_search: command-only');
    expect(text).toContain('book_search: command-only');
    expect(text).toContain('generate_image: OFF');
    expect(text).toContain('slash /papers');
    expect(text).toContain('slash /books');
    expect(text).toContain('slash /image OR enable Generate Image');
  });

  it('reports generate_image ON when enabled; paper/book stay command-only', () => {
    const text = activeIntegrationsPrompt({
      searchEnabled: true,
      integrations: ['paper_search', 'book_search', 'generate_image'],
    });
    expect(text).toContain('paper_search: command-only');
    expect(text).toContain('book_search: command-only');
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
