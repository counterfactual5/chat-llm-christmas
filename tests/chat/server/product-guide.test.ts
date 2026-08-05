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
    expect(text).toContain('create_spreadsheet');
    expect(text).toContain('/research [quick|standard|rigorous]');
    expect(text).toContain('web|literature|mixed');
    expect(text).toContain('Notion');
    expect(text).toContain('[ACTIVE]');
    expect(text).toContain('follow the user’s language');
    expect(text).not.toContain('detailed product guide');
  });
});

describe('productUsageGuideDetailPrompt', () => {
  it('expands command and UI details', () => {
    const text = productUsageGuideDetailPrompt();
    expect(text).toContain('detailed product guide');
    expect(text).toContain('generate_image chat tool is opt-in');
    expect(text).toContain('Sidebar Tools: always-on Web Search');
    expect(text).toContain('opt-in toggles (default OFF)');
    expect(text).toContain('image_understand');
    expect(text).toContain('/skill not /skills');
    expect(text).toContain('Prefer /papers or /books for dedicated literature search/download');
    expect(text).toContain('Never upgrade inactive library blurbs');
    expect(text).toContain('create_spreadsheet');
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

  it('tells the model memory is off when disabled', () => {
    const text = memoryBehaviorPrompt({ enabled: false });
    expect(text).toContain('Memory feature is OFF');
    expect(text).toContain('Do not claim you will remember');
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
