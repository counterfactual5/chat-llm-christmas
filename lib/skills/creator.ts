/**
 * `/skill` command workflow that interviews the user and writes a reusable Skill.
 * Stays active for create → iterate → replace until the user turns Skill Creator off.
 */

export const SKILL_CREATOR_ID = 'builtin:skill-creator';

export const SKILL_CREATOR_CONTENT = [
  'You are the /skill command workflow for this chat product.',
  'Goal: turn the user\'s rough idea into ONE complete, reusable Skill (a system prompt) they can save to their account.',
  'Stay focused on creating or replacing Skills. Skill Creator stays ON after a successful save so the user can immediately refine and overwrite — do not pretend the tool disappeared. The user dismisses the Skill Creator chip in the composer when done.',
  '',
  'Interview checklist (ask briefly, batch questions):',
  '1) Purpose & scope — what task/workflow should it handle?',
  '2) Trigger scenarios — when should it activate?',
  '3) Domain knowledge — what the model would not already know',
  '4) Constraints — what it must/never do, tone, language',
  '5) Output format — templates, structure, length',
  '6) 1–2 anti-examples — what bad output looks like',
  '7) Create vs replace — if the user wants to overwrite an existing Skill, confirm which one (use the account skill catalog id/title).',
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
  '- Create new: pass title + content only.',
  '- Replace/overwrite an existing Skill: also pass id (preferred) or replace_title from the account skill catalog. Do not create a duplicate when the user asked to replace.',
  '- After a successful save, if the user asks to update/replace again, call save_skill again with id or replace_title — do not say the environment cannot save.',
  '- NEVER claim the Skill is saved unless save_skill returned success with an id — narrating "已保存" without that tool call is a failure.',
  '- If save_skill fails, report the exact error and wait for the user before retrying. Do NOT dump the Skill as a downloadable file or a giant fenced block as a substitute.',
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

/** Short library blurb — prefer explicit description, else first lines of content. */
export function skillLibraryBlurb(
  skill: { description?: string; content?: string },
  max = 140,
): string {
  const explicit = String(skill.description || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (explicit) return explicit.length <= max ? explicit : `${explicit.slice(0, max - 1)}…`;
  const body = String(skill.content || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!body) return '';
  return body.length <= max ? body : `${body.slice(0, max - 1)}…`;
}

/**
 * Account Skills library for the model: titles + short blurbs only.
 * Full prompts are injected separately for ACTIVE skills.
 */
export function formatAccountSkillCatalog(
  skills: Array<{ id?: string; title?: string; description?: string; content?: string }>,
  opts?: { activeIds?: Iterable<string>; skillCreatorOn?: boolean },
): string {
  const active = new Set(
    [...(opts?.activeIds || [])].map((id) => String(id || '').trim()).filter(Boolean),
  );
  const lines = skills
    .map((s) => {
      const id = String(s?.id || '').trim();
      const title = String(s?.title || '').trim();
      if (!id || !title) return '';
      const blurb = skillLibraryBlurb(s);
      const flag = active.has(id) ? ' [ACTIVE]' : '';
      return blurb
        ? `- id=${id} · ${title}${flag} — ${blurb}`
        : `- id=${id} · ${title}${flag}`;
    })
    .filter(Boolean)
    .slice(0, 80);
  if (!lines.length) return '';
  const header = opts?.skillCreatorOn
    ? 'Account Skills library (title + short description only; full prompts inject only for [ACTIVE]). For save_skill replace/overwrite prefer id; replace_title only when unique:'
    : 'Account Skills library (title + short description only; full prompts inject only for [ACTIVE]). These are NOT active instructions unless marked [ACTIVE]. To save/replace via AI, user must run /skill first.';
  return [header, ...lines].join('\n');
}

/**
 * Always-relevant product rule for persisting Skills.
 * When Skill Creator is off, save_skill is not in the tool list — steer the model
 * to ask the user to enable /skill (or use sidebar manual add) instead of file dumps.
 */
export function skillPersistenceGatePrompt(skillCreatorOn: boolean): string {
  const trustPrior =
    'Tool receipts already in this chat are authoritative: if a prior save_skill (or other tool) returned ok:true / an id, that write already happened on the account — never retract it, never say it was fake because THIS-turn flags differ, and never tell the user to re-save manually unless a later tool call actually failed.';
  if (skillCreatorOn) {
    return `Skill Creator ON: after confirmation call save_skill (create, or overwrite via id / replace_title). Iterate/replace in this chat with the same tool. Never claim saved without tool success; never dump a file or full Skill body as a substitute. ${trustPrior}`;
  }
  return `Skill Creator OFF: save_skill unavailable THIS turn only. If the user wants AI to save/replace again, reply in ONE short sentence: run /skill (or Commands → Create with AI), or use sidebar Add manually / 手动添加. Do not invent a save tool. Do not paste the full Skill body, a fenced dump, or a downloadable file as a substitute. ${trustPrior}`;
}
