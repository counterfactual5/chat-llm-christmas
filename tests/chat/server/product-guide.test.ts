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
    expect(text).toContain('Request review');
    expect(text).toContain('Continue reply');
    expect(text).toContain('手动添加');
    expect(text).toContain('create_file');
    expect(text).toContain('follow the user’s language');
  });
});

describe('productUsageGuideDetailPrompt', () => {
  it('expands command and UI details', () => {
    const text = productUsageGuideDetailPrompt();
    expect(text).toContain('detailed product guide');
    expect(text).toContain('CLIENT command');
    expect(text).toContain('Sidebar Tools');
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
