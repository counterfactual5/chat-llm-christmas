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
});
