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
    memories: [{ kind: 'preference', content: '  Prefer Chinese  ' }],
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
    expect(parts.join('\n')).toContain('Known facts about the user');
    expect(parts.join('\n')).toContain('[preference] Prefer Chinese');
    expect(parts.join('\n')).toContain('Reference material provided by the user. Treat it as authoritative context:\n\nReference facts');
    expect(parts.join('\n')).not.toContain('Skip me');
    expect(joinChatSystemParts(['one', 'two'])).toBe('one\n\n---\n\ntwo');
  });

  it('always advertises native rich-output support without inventing tools', () => {
    const parts = buildChatSystemParts(base).join('\n');

    expect(parts).toContain('renders standard Markdown');
    expect(parts).toContain('KaTeX math');
    expect(parts).toContain('Mermaid diagrams');
    expect(parts).toContain('Do NOT claim diagrams cannot be rendered');
    expect(parts).toContain('Only use tools present in the API tool list');
    expect(parts).toContain('Active Skills are user-selected per conversation');
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

  it('includes account skill catalog when Skill Creator needs replace targets', () => {
    const parts = buildChatSystemParts({
      ...base,
      skillCreatorOn: true,
      accountSkillCatalog: 'Account Skills catalog:\n- id=sk_1 · Demo',
    });
    expect(parts.join('\n')).toContain('id=sk_1 · Demo');
    expect(parts.join('\n')).toContain('Skill Creator is ON');
  });

  it('steers the model to ask for /skill when Skill Creator is off', () => {
    const parts = buildChatSystemParts({
      ...base,
      skillCreatorOn: false,
    }).join('\n');
    expect(parts).toContain('save_skill is NOT available');
    expect(parts).toContain('type /skill');
    expect(parts).toContain('do NOT dump the Skill as a downloadable file');
  });
});
