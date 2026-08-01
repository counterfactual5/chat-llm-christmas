/** Resolve create vs replace target for save_skill. */

export type AccountSkillSummary = { id: string; title: string };

export type SaveSkillArgs = {
  title?: string;
  content?: string;
  /** Existing skill id — triggers PUT overwrite. */
  id?: string;
  /** Match an existing skill by title when id is omitted — triggers PUT. */
  replace_title?: string;
};

export type ResolveSaveTargetResult =
  | { mode: 'create' }
  | { mode: 'replace'; id: string; matchedTitle: string }
  | { mode: 'error'; error: string };

function normTitle(title: string): string {
  return String(title || '').trim().toLowerCase();
}

/**
 * Prefer explicit id. Otherwise match replace_title (exact, case-insensitive).
 * No id and no replace_title ⇒ create.
 */
export function resolveSaveSkillTarget(
  args: SaveSkillArgs,
  accountSkills: AccountSkillSummary[],
): ResolveSaveTargetResult {
  const id = String(args.id || '').trim();
  if (id) {
    const hit = accountSkills.find((s) => s.id === id);
    return {
      mode: 'replace',
      id,
      matchedTitle: hit?.title || id,
    };
  }

  const replaceTitle = String(args.replace_title || '').trim();
  if (!replaceTitle) return { mode: 'create' };

  const needle = normTitle(replaceTitle);
  const matches = accountSkills.filter((s) => normTitle(s.title) === needle);
  if (matches.length === 1) {
    return { mode: 'replace', id: matches[0].id, matchedTitle: matches[0].title };
  }
  if (matches.length === 0) {
    // Soft match: title contains / is contained by needle (unique only).
    const soft = accountSkills.filter((s) => {
      const t = normTitle(s.title);
      return t.includes(needle) || needle.includes(t);
    });
    if (soft.length === 1) {
      return { mode: 'replace', id: soft[0].id, matchedTitle: soft[0].title };
    }
    if (soft.length > 1) {
      return {
        mode: 'error',
        error: `Multiple skills match replace_title "${replaceTitle}". Pass id explicitly: ${soft
          .map((s) => `${s.id} (${s.title})`)
          .join(', ')}`,
      };
    }
    return {
      mode: 'error',
      error: `No existing skill matches replace_title "${replaceTitle}". Create instead (omit replace_title/id) or pass a valid id.`,
    };
  }
  return {
    mode: 'error',
    error: `Multiple skills titled "${replaceTitle}". Pass id explicitly: ${matches
      .map((s) => s.id)
      .join(', ')}`,
  };
}
