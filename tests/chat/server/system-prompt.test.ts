import { describe, expect, it } from 'vitest';
import { buildChatSystemParts, joinChatSystemParts } from '@/lib/chat/server/system-prompt';
import { cursorWebChatPrompt } from '@/lib/models/specs';

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
    expect(parts).toContain('/image client command');
  });

  it('includes a product usage guide for Commands and features', () => {
    const parts = buildChatSystemParts(base).join('\n');

    expect(parts).toContain('product usage guide');
    expect(parts).toContain('/image <prompt>');
    expect(parts).toContain('/skill');
    expect(parts).toContain('Request review');
    expect(parts).toContain('Continue reply');
    expect(parts).toContain('Add manually');
    expect(parts).toContain('create_file');
    expect(parts).toContain('Files — account file manager');
    expect(parts).toContain('Memories');
    expect(parts).toContain('Account memory behavior');
    expect(parts).toContain('no memory-write tool');
  });

  it('lists create_file and command inventory in active capabilities', () => {
    const parts = buildChatSystemParts({
      ...base,
      skillCreatorOn: false,
      searchEnabled: false,
      authorizedIntegrations: [],
    }).join('\n');

    expect(parts).toContain('create_file: save downloadable');
    expect(parts).toContain('save_skill: OFF');
    expect(parts).toContain('web_search / web_read: not enabled');
    expect(parts).toContain('/image (generate image)');
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
    expect(parts.join('\n')).toContain('save_skill: ON');
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

describe('cursorWebChatPrompt', () => {
  it('does not advertise web_search when search is off', () => {
    const off = cursorWebChatPrompt({ searchEnabled: false });
    expect(off).toContain('本轮未启用网页搜索');
    expect(off).not.toContain('公开网页资料请用 web_search');
    expect(off).toContain('create_file');
    expect(off).toContain('/image');
  });

  it('mentions web_search when search is on', () => {
    const on = cursorWebChatPrompt({ searchEnabled: true });
    expect(on).toContain('公开网页资料请用 web_search');
  });
});
