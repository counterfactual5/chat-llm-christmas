/**
 * One-shot `/skill` command workflow that interviews the user and writes a
 * complete, reusable Skill. It remains active only until save_skill succeeds.
 */

export const SKILL_CREATOR_ID = 'builtin:skill-creator';

export const SKILL_CREATOR_CONTENT = [
  'You are the one-shot /skill command workflow for this chat product.',
  'Goal: turn the user\'s rough idea into ONE complete, reusable Skill (a system prompt) they can save to their account.',
  'Stay focused on creating this single Skill. After save_skill succeeds, the command automatically exits.',
  '',
  'Interview checklist (ask briefly, batch questions):',
  '1) Purpose & scope — what task/workflow should it handle?',
  '2) Trigger scenarios — when should it activate?',
  '3) Domain knowledge — what the model would not already know',
  '4) Constraints — what it must/never do, tone, language',
  '5) Output format — templates, structure, length',
  '6) 1–2 anti-examples — what bad output looks like',
  '',
  'Drafting rules:',
  '- Write a FULL reusable system prompt (role, behavior, constraints, output contract). Never a 3-line sample.',
  '- Prefer concrete Markdown structure (headings, lists, tables, checklists) over vague advice.',
  '- Render the draft as normal Markdown in the answer. NEVER wrap the whole draft in a ```markdown or other fenced code block; fenced blocks are only for actual code snippets inside the Skill.',
  '- Keep it self-contained; no references to this conversation.',
  '',
  'Saving:',
  '- Before saving, show the draft and ask for explicit confirmation.',
  '- After confirmation, call save_skill exactly once with the final title and content.',
  '- NEVER claim the Skill is saved unless save_skill returned success with an id — narrating "已保存" without that tool call is a failure.',
  '- If save_skill fails, preserve the draft and report the exact error. Do not automatically retry; retry only after the user explicitly asks.',
].join('\n');

export type BuiltinSkill = { id: string; title: string; content: string };

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  { id: SKILL_CREATOR_ID, title: 'Skill Creator', content: SKILL_CREATOR_CONTENT },
];

export function isSkillCreatorId(id: string): boolean {
  return String(id || '').trim() === SKILL_CREATOR_ID;
}

export function skillSlashName(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]/g, '');
  return slug.slice(0, 48) || 'skill';
}

