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
      contextBreakdown: { system: isomorphic.system, skills: isomorphic.skills },
    });
    const legacy = estimateTokensForSend({
      history: [],
      nextUserText: 'hi',
      pendingImageCount: 0,
      contextBreakdown: {
        system: estimateTokensFromText(DEFAULT_SYSTEM_PROMPT),
        skills: 0,
      },
    });
    expect(projected).toBeGreaterThan(legacy);
  });

  it('drops discarded-turn webSources from system when history is truncated', () => {
    const staleSource = {
      title: 'Old hit',
      url: 'https://example.com/old',
      snippet: 'from a rolled-back turn',
    };
    const withStale = estimateContextBreakdown({
      model: 'gpt-4o',
      systemPrompt: '',
      threadId: 't1',
      searchEnabled: true,
      authorizedIntegrations: [],
      skills: [],
      webSources: [staleSource],
      attachmentTexts: [],
      messages: [],
      pendingImageCount: 0,
    });
    const truncated = estimateContextBreakdown({
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
    expect(withStale.system).toBeGreaterThan(truncated.system);
    expect(withStale.reference).toBeGreaterThan(0);
    expect(truncated.reference).toBe(0);
  });

  it('infers generated-image system block from assistant messages', () => {
    const empty = estimateContextBreakdown({
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
    const withImage = estimateContextBreakdown({
      model: 'gpt-4o',
      systemPrompt: '',
      threadId: 't1',
      searchEnabled: true,
      authorizedIntegrations: [],
      skills: [],
      webSources: [],
      attachmentTexts: [],
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          content: 'here',
          timestamp: 1,
          images: [{ url: 'https://example.com/x.png' }],
        },
      ],
      pendingImageCount: 0,
    });
    expect(withImage.system).toBeGreaterThan(empty.system);
  });

  it('increases system when toolsGuidance is provided', () => {
    const bare = estimateContextBreakdown({
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
      toolsGuidance: '',
    });
    const guided = estimateContextBreakdown({
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
      toolsGuidance: 'You have a web_search tool. '.repeat(40),
    });
    expect(guided.system).toBeGreaterThan(bare.system);
  });

  it('raises conversation when history has large tool result bodies', () => {
    const baseArgs = {
      model: 'gpt-4o',
      systemPrompt: '',
      threadId: 't1',
      searchEnabled: true,
      authorizedIntegrations: [] as string[],
      skills: [],
      webSources: [],
      attachmentTexts: [],
      pendingImageCount: 0,
    };
    const plainMsg = {
      id: 'a1',
      role: 'assistant' as const,
      content: 'Answer',
      timestamp: 1,
    };
    const toolMsg = {
      ...plainMsg,
      toolRuns: [
        {
          id: 'tr1',
          name: 'web_search',
          status: 'done' as const,
          query: 'q',
          results: [
            {
              title: 't',
              url: 'https://example.com',
              snippet: 's',
              body: 'w'.repeat(8000),
            },
          ],
        },
      ],
    };
    const plain = estimateContextBreakdown({
      ...baseArgs,
      messages: [plainMsg],
    });
    const withTools = estimateContextBreakdown({
      ...baseArgs,
      messages: [toolMsg],
    });
    expect(withTools.conversation).toBeGreaterThan(plain.conversation);
    expect(withTools.system).toBe(plain.system);

    const projectedPlain = estimateTokensForSend({
      history: [plainMsg],
      nextUserText: 'next',
      pendingImageCount: 0,
      contextBreakdown: { system: plain.system },
    });
    const projectedTools = estimateTokensForSend({
      history: [toolMsg],
      nextUserText: 'next',
      pendingImageCount: 0,
      contextBreakdown: { system: withTools.system },
    });
    expect(projectedTools).toBeGreaterThan(projectedPlain);
  });
});
