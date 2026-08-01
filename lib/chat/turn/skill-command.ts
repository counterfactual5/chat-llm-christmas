/** Skill Creator command. Stays active for create/iterate/replace until the user turns it off. */
const SKILL_COMMAND_RE = /^\/(?:skill|skill-create)(?:\s+([\s\S]*))?$/i;

export function parseSkillCommand(text: string): string | null {
  const match = String(text || '').trim().match(SKILL_COMMAND_RE);
  if (!match) return null;
  return String(match[1] || '').trim();
}

export function isSkillCommand(text: string): boolean {
  return SKILL_COMMAND_RE.test(String(text || '').trim());
}
