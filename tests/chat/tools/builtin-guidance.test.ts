import { describe, expect, it } from 'vitest';
import { estimateBuiltinToolsGuidance } from '@/lib/tools/builtin-guidance';
import { toolSystemPrompt, selectTools } from '@/lib/tools/registry';
import { builtinToolRegistry } from '@/lib/tools';

describe('estimateBuiltinToolsGuidance', () => {
  it('matches toolSystemPrompt(selectTools(builtin)) for default flags', () => {
    const flags = { searchEnabled: true, integrations: [] as string[] };
    const viaHelper = estimateBuiltinToolsGuidance(flags);
    const viaRegistry = toolSystemPrompt(
      selectTools(builtinToolRegistry(), flags),
    );
    expect(viaHelper).toBe(viaRegistry);
    expect(viaHelper.length).toBeGreaterThan(500);
  });

  it('grows when paper_search is enabled', () => {
    const base = estimateBuiltinToolsGuidance({
      searchEnabled: true,
      integrations: [],
    });
    const withPapers = estimateBuiltinToolsGuidance({
      searchEnabled: true,
      integrations: ['paper_search'],
    });
    expect(withPapers.length).toBeGreaterThan(base.length);
  });
});
