import { describe, expect, it } from 'vitest';
import { isSkillCommand, parseSkillCommand } from '@/lib/chat/turn/skill-command';

describe('Skill Creator command', () => {
  it('parses /skill and its compatibility alias', () => {
    expect(parseSkillCommand('/skill 做一个金融数据助手')).toBe('做一个金融数据助手');
    expect(parseSkillCommand('/skill-create 代码审查')).toBe('代码审查');
    expect(parseSkillCommand('/skill')).toBe('');
  });

  it('does not consume ordinary saved-skill slash commands', () => {
    expect(parseSkillCommand('/skill-finance')).toBeNull();
    expect(isSkillCommand('/skills')).toBe(false);
  });
});
