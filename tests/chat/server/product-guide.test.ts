import { describe, expect, it } from 'vitest';
import {
  memoryBehaviorPrompt,
  productUsageGuidePrompt,
} from '@/lib/chat/server/product-guide';

describe('productUsageGuidePrompt', () => {
  it('covers built-in commands and major surfaces', () => {
    const text = productUsageGuidePrompt();
    expect(text).toContain('/image');
    expect(text).toContain('/skill');
    expect(text).toContain('Request review');
    expect(text).toContain('Continue reply');
    expect(text).toContain('手动添加');
    expect(text).toContain('create_file');
    expect(text).toContain('Files — account file manager');
    expect(text).toContain('what can you do');
  });
});

describe('memoryBehaviorPrompt', () => {
  it('forbids fake memory-write claims', () => {
    const text = memoryBehaviorPrompt();
    expect(text).toContain('no memory-write tool');
    expect(text).toContain('do NOT claim a memory entry was already saved');
  });
});
