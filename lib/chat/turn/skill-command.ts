/** One-shot Skill Creator command. The creator stays active until save succeeds. */
const SKILL_COMMAND_RE = /^\/(?:skill|skill-create)(?:\s+([\s\S]*))?$/i;

export function parseSkillCommand(text: string): string | null {
  const match = String(text || '').trim().match(SKILL_COMMAND_RE);
  if (!match) return null;
  return String(match[1] || '').trim();
}

export function isSkillCommand(text: string): boolean {
  return SKILL_COMMAND_RE.test(String(text || '').trim());
}
