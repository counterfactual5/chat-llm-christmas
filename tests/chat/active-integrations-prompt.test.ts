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

  it('reports opt-in paper/book/image tools as OFF by default', () => {
    const text = activeIntegrationsPrompt({
      searchEnabled: true,
      integrations: [],
    });
    expect(text).toContain('paper_search: OFF');
    expect(text).toContain('book_search: OFF');
    expect(text).toContain('generate_image: OFF');
    expect(text).toContain('/papers');
    expect(text).toContain('/books');
    expect(text).toContain('/image');
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
});
