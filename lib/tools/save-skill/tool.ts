import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';
import { SKILL_CREATOR_ID } from '@/lib/skills/creator';
import { chatBackendSkillsURL } from '@/lib/chat-backend';
import {
  resolveSaveSkillTarget,
  type AccountSkillSummary,
  type SaveSkillArgs,
} from '@/lib/tools/save-skill/resolve-target';

export function skillsApiURL(): string {
  return chatBackendSkillsURL();
}

/** @deprecated use skillsApiURL() — kept for existing imports */
export const SKILLS_API_URL = 'https://api.chat.llm.christmas/v1/skills';

function skillCreatorActive(ctx: ToolRuntimeContext): boolean {
  const skills = ctx.requestSkills || [];
  return skills.some((s) => String((s as any)?.id || '').trim() === SKILL_CREATOR_ID);
}

async function listAccountSkills(apiKey: string): Promise<AccountSkillSummary[]> {
  const res = await fetch(skillsApiURL(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    cache: 'no-store',
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String(data?.error || `Failed to list skills (${res.status})`));
  }
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows
    .map((row: any) => ({
      id: String(row?.id || '').trim(),
      title: String(row?.title || '').trim(),
    }))
    .filter((row: AccountSkillSummary) => row.id && row.title);
}

export function createSaveSkillTool(): ChatTool {
  return {
    name: 'save_skill',
    definition: {
      type: 'function',
      function: {
        name: 'save_skill',
        description:
          'Create or overwrite a Skill on the user\'s account. Omit id/replace_title to create. Pass id (preferred) or replace_title to overwrite an existing Skill. Only call after the user explicitly confirmed the draft. Never narrate "saved" without this tool returning success.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short Skill name (≤80 chars).' },
            content: {
              type: 'string',
              description: 'Complete reusable Skill system prompt.',
            },
            id: {
              type: 'string',
              description: 'Existing Skill id to overwrite (PUT). Prefer this when replacing.',
            },
            replace_title: {
              type: 'string',
              description:
                'When id is unknown, match an existing Skill by title and overwrite it. Use the exact or unique title from the account skill catalog.',
            },
          },
          required: ['title', 'content'],
        },
      },
    },
    systemPrompt:
      'When the /skill draft is confirmed, call save_skill exactly once. Create: title+content only. Replace/overwrite: also pass id (preferred) or replace_title from the account skill catalog. Saving without tool success is a failure. If it fails, report the exact error and wait for the user before retrying. Never dump the Skill as a downloadable file as a substitute for save_skill.',
    enabled: (flags) => flags.integrations.includes('skill-creator'),
    async execute({ rawArguments }, ctx) {
      if (!skillCreatorActive(ctx)) {
        return {
          content: JSON.stringify({ ok: false, error: 'Skill Creator is not active for this chat.' }),
        };
      }
      const apiKey = String(ctx.credentials?.skillsApiKey || '').trim();
      if (!apiKey) {
        return {
          content: JSON.stringify({ ok: false, error: 'Account is not connected.' }),
        };
      }

      let args: SaveSkillArgs = {};
      try {
        args = JSON.parse(rawArguments || '{}') || {};
      } catch {}
      const title = String(args.title || '').trim().slice(0, 80);
      const content = String(args.content || '').trim();
      if (!title || !content) {
        return {
          content: JSON.stringify({
            ok: false,
            error: 'save_skill requires non-empty title and content',
          }),
        };
      }

      const wantsReplace = Boolean(String(args.id || '').trim() || String(args.replace_title || '').trim());
      const queryLabel = wantsReplace ? 'update Skill' : 'save Skill';
      ctx.send({
        tool: { status: 'start', name: 'save_skill', provider: 'skills', query: queryLabel },
      });

      try {
        let accountSkills: AccountSkillSummary[] = [];
        if (wantsReplace) {
          accountSkills = await listAccountSkills(apiKey);
        }
        const target = resolveSaveSkillTarget(args, accountSkills);
        if (target.mode === 'error') {
          throw new Error(target.error);
        }

        const method = target.mode === 'replace' ? 'PUT' : 'POST';
        const url =
          target.mode === 'replace'
            ? `${skillsApiURL()}/${encodeURIComponent(target.id)}`
            : skillsApiURL();
        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ title, content }),
          cache: 'no-store',
        });
        const data: any = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(String(data?.error || `Skill save failed (${res.status})`));
        }
        const saved =
          data?.data ||
          (target.mode === 'replace'
            ? { id: target.id, title, content }
            : { id: `skill_${Date.now()}`, title, content });
        ctx.send({
          tool: {
            status: 'done',
            name: 'save_skill',
            provider: 'skills',
            query: queryLabel,
            results: [
              {
                title: String(saved.title || title),
                url: '',
                snippet:
                  target.mode === 'replace'
                    ? `updated:${String(saved.id || target.id)}`
                    : String(saved.id || ''),
              },
            ],
          },
        });
        return {
          content: JSON.stringify({
            ok: true,
            mode: target.mode,
            skill: saved,
            ...(target.mode === 'replace' ? { replaced: target.matchedTitle } : {}),
          }),
          data: saved,
        };
      } catch (err: any) {
        const message = String(err?.message || 'save_skill failed');
        ctx.send({
          tool: {
            status: 'done',
            name: 'save_skill',
            provider: 'skills',
            query: queryLabel,
            error: message,
          },
        });
        return { content: JSON.stringify({ ok: false, error: message }) };
      }
    },
  };
}
