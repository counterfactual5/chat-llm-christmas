import { describe, expect, it } from 'vitest';
import {
  formatAccountSkillCatalog,
  skillPersistenceGatePrompt,
} from '@/lib/skills/creator';
import { resolveSaveSkillTarget } from '@/lib/tools/save-skill/resolve-target';

describe('resolveSaveSkillTarget', () => {
  const skills = [
    { id: 'sk_a', title: '全球金融数据获取与分析助手' },
    { id: 'sk_b', title: 'Code Review' },
    { id: 'sk_c', title: 'Code Review Helper' },
  ];

  it('creates when neither id nor replace_title is set', () => {
    expect(resolveSaveSkillTarget({ title: 'New', content: 'x' }, skills)).toEqual({
      mode: 'create',
    });
  });

  it('replaces by explicit id', () => {
    expect(
      resolveSaveSkillTarget({ title: 'T', content: 'x', id: 'sk_a' }, skills),
    ).toEqual({
      mode: 'replace',
      id: 'sk_a',
      matchedTitle: '全球金融数据获取与分析助手',
    });
  });

  it('replaces by exact title (case-insensitive)', () => {
    expect(
      resolveSaveSkillTarget(
        { title: 'T', content: 'x', replace_title: 'code review' },
        skills,
      ),
    ).toEqual({
      mode: 'replace',
      id: 'sk_b',
      matchedTitle: 'Code Review',
    });
  });

  it('soft-matches a unique partial title', () => {
    expect(
      resolveSaveSkillTarget(
        { title: 'T', content: 'x', replace_title: '全球金融' },
        skills,
      ),
    ).toEqual({
      mode: 'replace',
      id: 'sk_a',
      matchedTitle: '全球金融数据获取与分析助手',
    });
  });

  it('errors when soft match is ambiguous', () => {
    const result = resolveSaveSkillTarget(
      { title: 'T', content: 'x', replace_title: 'Code Review' },
      // exact matches sk_b only — use a softer needle against both code skills
      [{ id: 'sk_b', title: 'Code Review' }, { id: 'sk_c', title: 'Code Review Helper' }],
    );
    // exact title "Code Review" hits sk_b only
    expect(result).toEqual({
      mode: 'replace',
      id: 'sk_b',
      matchedTitle: 'Code Review',
    });

    const ambiguous = resolveSaveSkillTarget(
      { title: 'T', content: 'x', replace_title: 'Code' },
      skills,
    );
    expect(ambiguous.mode).toBe('error');
  });

  it('errors when nothing matches', () => {
    const result = resolveSaveSkillTarget(
      { title: 'T', content: 'x', replace_title: '不存在的技能' },
      skills,
    );
    expect(result.mode).toBe('error');
  });
});

describe('formatAccountSkillCatalog', () => {
  it('formats id/title lines and skips empties', () => {
    const text = formatAccountSkillCatalog([
      { id: '1', title: 'Alpha' },
      { id: '', title: 'Nope' },
      { id: '2', title: 'Beta' },
    ]);
    expect(text).toContain('id=1 · Alpha');
    expect(text).toContain('id=2 · Beta');
    expect(text).not.toContain('Nope');
    expect(text).toContain('Account Skills library');
  });

  it('prefers description and marks active skills', () => {
    const text = formatAccountSkillCatalog(
      [
        {
          id: '1',
          title: 'Alpha',
          description: 'Short blurb',
          content: 'long body ignored when description exists',
        },
        { id: '2', title: 'Beta', content: 'First line of prompt that becomes excerpt' },
      ],
      { activeIds: ['1'], skillCreatorOn: true },
    );
    expect(text).toContain('[ACTIVE]');
    expect(text).toContain('Short blurb');
    expect(text).toContain('First line of prompt');
    expect(text).toContain('save_skill');
  });
});

describe('skillPersistenceGatePrompt', () => {
  it('asks the user to enable /skill when creator is off', () => {
    const off = skillPersistenceGatePrompt(false);
    expect(off).toContain('Skill Creator OFF');
    expect(off).toContain('/skill');
    expect(off).toContain('手动添加');
    expect(off).toContain('Do not paste the full Skill body');
    expect(off).toContain('Past tool outcomes');
    expect(off).toContain('cannot create or replace');
    const on = skillPersistenceGatePrompt(true);
    expect(on).toContain('Skill Creator ON');
    expect(on).toContain('save_skill');
    expect(on).toContain('Iterate/replace');
    expect(on).toContain('Past tool outcomes');
  });
});
