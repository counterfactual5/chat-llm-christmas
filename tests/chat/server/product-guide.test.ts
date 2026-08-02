import { describe, expect, it } from 'vitest';
import {
  autoReviewStatusPrompt,
  memoryBehaviorPrompt,
  productUsageGuideDetailPrompt,
  productUsageGuidePrompt,
  wantsProductUsageHelp,
} from '@/lib/chat/server/product-guide';

describe('productUsageGuidePrompt', () => {
  it('covers built-in commands in a compact always-on map', () => {
    const text = productUsageGuidePrompt();
    expect(text).toContain('quick product map');
    expect(text).toContain('/image');
    expect(text).toContain('/skill');
    expect(text).toContain('/skill singular');
    expect(text).toContain('Request review');
    expect(text).toContain('Continue reply');
    expect(text).toContain('手动添加');
    expect(text).toContain('create_file');
    expect(text).toContain('/research [quick|standard|rigorous]');
    expect(text).toContain('web|literature|mixed');
    expect(text).toContain('image_understand');
    expect(text).toContain('Notion');
    expect(text).toContain('zhipu-vision');
    expect(text).toContain('not a dedicated finance/market data feed');
    expect(text).toContain('NOT product features');
    expect(text).toContain('[ACTIVE]');
    expect(text).toContain('prefer GitHub tools over generic web');
    expect(text).toContain('follow the user’s language');
  });
});

describe('productUsageGuideDetailPrompt', () => {
  it('expands command and UI details', () => {
    const text = productUsageGuideDetailPrompt();
    expect(text).toContain('detailed product guide');
    expect(text).toContain('CLIENT command');
    expect(text).toContain('Sidebar Tools lists built-in always-on tools');
    expect(text).toContain('GitHub MCP is enabled for this chat, it is the primary path');
    expect(text).toContain('generic webpage reading is fallback only');
    expect(text).toContain('no first-class finance');
    expect(text).toContain('image_understand');
    expect(text).toContain('/skill not /skills');
    expect(text).toContain('prefer /papers or /books for dedicated literature');
    expect(text).toContain('Never upgrade inactive library blurbs');
  });
});

describe('wantsProductUsageHelp', () => {
  it('detects how-to / what-commands asks', () => {
    expect(wantsProductUsageHelp('这个产品怎么用？')).toBe(true);
    expect(wantsProductUsageHelp('有哪些命令')).toBe(true);
    expect(wantsProductUsageHelp('what can you do')).toBe(true);
    expect(wantsProductUsageHelp('how to use this chat')).toBe(true);
    expect(wantsProductUsageHelp('帮我写一段 TypeScript')).toBe(false);
  });
});

describe('memoryBehaviorPrompt', () => {
  it('forbids fake memory-write claims', () => {
    const text = memoryBehaviorPrompt();
    expect(text).toContain('No memory-write tool');
    expect(text).toContain('do NOT claim it was saved');
  });
});

describe('autoReviewStatusPrompt', () => {
  it('describes on/off/manual states', () => {
    expect(autoReviewStatusPrompt({ autoReview: false, requestReview: false })).toContain(
      'Auto-review is OFF',
    );
    expect(autoReviewStatusPrompt({ autoReview: true, requestReview: false })).toContain(
      'Auto-review is ON',
    );
    expect(autoReviewStatusPrompt({ autoReview: true, requestReview: true })).toContain(
      'manually requested',
    );
  });
});
