import { describe, expect, it } from 'vitest';
import { buildChatSystemParts, joinChatSystemParts } from '@/lib/chat/server/system-prompt';

describe('buildChatSystemParts', () => {
  const base = {
    model: 'gpt-test',
    systemPrompt: '  Custom instructions  ',
    threadId: 'thread-42',
    searchEnabled: true,
    authorizedIntegrations: ['notion'],
    googleRequestedButUnauthorized: false,
    toolsGuidance: 'Use registered tools.',
    skills: [
      { title: 'Keep me', content: '  Skill instructions  ' },
      { title: 'Skip me', content: '   ' },
    ],
    requestReview: false,
    autoReview: false,
    referenceText: '  Reference facts  ',
    hasGeneratedImages: false,
    hasGeneratedFiles: false,
  };

  it('assembles only meaningful optional context in the established order', () => {
    const parts = buildChatSystemParts(base);

    expect(parts).toContain('Custom instructions');
    expect(parts).toContain('Use registered tools.');
    expect(parts).toContain('Active Skill — Keep me:\nSkill instructions');
    expect(parts.join('\n')).toContain('Reference material provided by the user. Treat it as authoritative context:\n\nReference facts');
    expect(parts.join('\n')).not.toContain('Skip me');
    expect(joinChatSystemParts(['one', 'two'])).toBe('one\n\n---\n\ntwo');
  });

  it('adds review and generated-output safeguards when requested', () => {
    const parts = buildChatSystemParts({
      ...base,
      requestReview: true,
      autoReview: true,
      hasGeneratedImages: true,
      hasGeneratedFiles: true,
    }).join('\n');

    expect(parts).toContain('The user explicitly requested a claim review');
    expect(parts).toContain('This chat already contains image(s) generated');
    expect(parts).toContain('This chat already contains downloadable file(s) created via create_file.');
  });
});
