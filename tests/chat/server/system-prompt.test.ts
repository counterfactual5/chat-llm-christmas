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

  it('keeps anti-hallucination capability contract without Markdown style coaching', () => {
    const parts = buildChatSystemParts(base).join('\n');

    expect(parts).toContain('Only use tools present in THIS request');
    expect(parts).toContain('Never claim an image or downloadable file was created');
    expect(parts).toContain('Active Skills are user-selected per conversation');
    expect(parts).toContain('There is NO /news or /wiki slash command');
    expect(parts).toContain('use it first for github.com');
    expect(parts).toContain('file_read is lazy');
    expect(parts).toContain('/skill (singular) is always available');
    expect(parts).not.toContain('Block Markdown MUST keep real newlines');
    expect(parts).not.toContain('Prefer Mermaid over Unicode');
  });

  it('keeps a compact product map always on', () => {
    const parts = buildChatSystemParts(base).join('\n');

    expect(parts).toContain('quick product map');
    expect(parts).toContain('/image');
    expect(parts).toContain('/skill');
    expect(parts).toContain('Request review');
    expect(parts).toContain('Continue reply');
    expect(parts).toContain('create_file');
    expect(parts).toContain('No memory-write tool');
    expect(parts).not.toContain('detailed product guide');
  });

  it('expands the detailed product guide on demand', () => {
    const parts = buildChatSystemParts({
      ...base,
      expandProductGuide: true,
    }).join('\n');
    expect(parts).toContain('detailed product guide');
    expect(parts).toContain('always-available slash command');
  });

  it('lists THIS-turn capability flags compactly', () => {
    const parts = buildChatSystemParts({
      ...base,
      skillCreatorOn: false,
      searchEnabled: false,
      authorizedIntegrations: [],
    }).join('\n');

    expect(parts).toContain('THIS-turn capability flags');
    expect(parts).toContain('save_skill: OFF');
    expect(parts).toContain('web_search/web_read: OFF');
    expect(parts).toContain('create_file / create_spreadsheet: usually ON');
  });

  it('states auto-review product status', () => {
    const off = buildChatSystemParts(base).join('\n');
    expect(off).toContain('Auto-review is OFF');

    const on = buildChatSystemParts({ ...base, autoReview: true }).join('\n');
    expect(on).toContain('Auto-review is ON');
    expect(on).toContain('not a tool you call');
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
    expect(parts).toContain('manually requested a review');
    expect(parts).toContain('This chat already contains image(s) generated');
    expect(parts).toContain('This chat already contains downloadable file(s)');
  });

  it('includes account skill catalog when Skill Creator needs replace targets', () => {
    const parts = buildChatSystemParts({
      ...base,
      skillCreatorOn: true,
      accountSkillCatalog: 'Account Skills catalog:\n- id=sk_1 · Demo',
    });
    expect(parts.join('\n')).toContain('id=sk_1 · Demo');
    expect(parts.join('\n')).toContain('Skill Creator ON');
    expect(parts.join('\n')).toContain('save_skill: ON');
  });

  it('steers the model to ask for /skill when Skill Creator is off', () => {
    const parts = buildChatSystemParts({
      ...base,
      skillCreatorOn: false,
    }).join('\n');
    expect(parts).toContain('Skill Creator OFF');
    expect(parts).toContain('/skill');
    expect(parts).toContain('Do not paste the full Skill body');
    expect(parts).toContain('Past tool results');
  });
});

describe('cursorWebChatPrompt', () => {
  it('does not advertise web_search when search is off', () => {
    const off = cursorWebChatPrompt({ searchEnabled: false });
    expect(off).toContain('本轮未启用网页搜索');
    expect(off).not.toContain('公开网页资料请用 web_search');
    expect(off).toContain('create_file');
  });

  it('mentions web_search when search is on', () => {
    const on = cursorWebChatPrompt({ searchEnabled: true });
    expect(on).toContain('公开网页资料请用 web_search');
  });
});
