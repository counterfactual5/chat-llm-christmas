import { describe, expect, it } from 'vitest';
import { estimateContextBreakdown } from '@/lib/chat/turn/context-estimate';
import { estimateTokensForSend } from '@/lib/chat/turn/send-estimate';
import { DEFAULT_SYSTEM_PROMPT, estimateTokensFromText } from '@/lib/models/specs';

describe('estimateContextBreakdown', () => {
  it('estimates system far above DEFAULT_SYSTEM_PROMPT alone', () => {
    const breakdown = estimateContextBreakdown({
      model: 'gpt-4o',
      systemPrompt: '',
      threadId: 't1',
      searchEnabled: true,
      authorizedIntegrations: [],
      skills: [],
      webSources: [],
      attachmentTexts: [],
      messages: [],
      pendingImageCount: 0,
      autoReview: true,
      memoriesEnabled: true,
    });
    const bare = estimateTokensFromText(DEFAULT_SYSTEM_PROMPT);
    expect(breakdown.system).toBeGreaterThan(500);
    expect(breakdown.system).toBeGreaterThan(bare * 5);
    expect(breakdown.source).toBe('estimate');
    expect(breakdown.total).toBe(
      breakdown.system +
        breakdown.files +
        breakdown.images +
        breakdown.conversation,
    );
  });

  it('increases system when expandProductGuide is on', () => {
    const base = estimateContextBreakdown({
      model: 'gpt-4o',
      systemPrompt: '',
      threadId: 't1',
      searchEnabled: true,
      authorizedIntegrations: [],
      skills: [],
      webSources: [],
      attachmentTexts: [],
      messages: [],
      pendingImageCount: 0,
      expandProductGuide: false,
    });
    const expanded = estimateContextBreakdown({
      model: 'gpt-4o',
      systemPrompt: '',
      threadId: 't1',
      searchEnabled: true,
      authorizedIntegrations: [],
      skills: [],
      webSources: [],
      attachmentTexts: [],
      messages: [],
      pendingImageCount: 0,
      expandProductGuide: true,
    });
    expect(expanded.system).toBeGreaterThan(base.system);
  });

  it('folds skills into system without double-counting total', () => {
    const withSkills = estimateContextBreakdown({
      model: 'gpt-4o',
      systemPrompt: '',
      threadId: 't1',
      searchEnabled: true,
      authorizedIntegrations: [],
      skills: [{ title: 'Test', content: 'Do the thing carefully with lots of detail.'.repeat(20) }],
      webSources: [],
      attachmentTexts: [],
      messages: [],
      pendingImageCount: 0,
    });
    expect(withSkills.skills).toBeGreaterThan(0);
    expect(withSkills.total).toBe(
      withSkills.system +
        withSkills.files +
        withSkills.images +
        withSkills.conversation,
    );
    expect(withSkills.total).not.toBe(
      withSkills.system + withSkills.skills,
    );
  });

  it('raises send estimate vs DEFAULT-only baseline', () => {
    const isomorphic = estimateContextBreakdown({
      model: 'gpt-4o',
      systemPrompt: '',
      threadId: 't1',
      searchEnabled: true,
      authorizedIntegrations: [],
      skills: [],
      webSources: [],
      attachmentTexts: [],
      messages: [],
      pendingImageCount: 0,
    });
    const projected = estimateTokensForSend({
      history: [],
      nextUserText: 'hi',
      pendingImageCount: 0,
      webSources: [],
      contextBreakdown: { system: isomorphic.system, skills: isomorphic.skills },
    });
    const legacy = estimateTokensForSend({
      history: [],
      nextUserText: 'hi',
      pendingImageCount: 0,
      webSources: [],
      contextBreakdown: {
        system: estimateTokensFromText(DEFAULT_SYSTEM_PROMPT),
        skills: 0,
      },
    });
    expect(projected).toBeGreaterThan(legacy);
  });
});
