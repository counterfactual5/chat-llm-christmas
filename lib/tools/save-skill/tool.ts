import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';
import { SKILL_CREATOR_ID } from '@/lib/skills/creator';

const MAIN_SITE_BASE = 'https://llm.christmas/portal/chat/skills';

function skillCreatorActive(ctx: ToolRuntimeContext): boolean {
  const skills = ctx.requestSkills || [];
  return skills.some((s) =>
    String((s as any)?.id || '').trim() === SKILL_CREATOR_ID,
  );
}

export function createSaveSkillTool(): ChatTool {
  return {
    name: 'save_skill',
    definition: {
      type: 'function',
      function: {
        name: 'save_skill',
        description:
          'Persist a finished Skill (title + complete system-prompt content) to the user\'s account. Only call after the user explicitly confirmed the draft. Never narrate "saved" without this tool returning success.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short Skill name (≤80 chars).' },
            content: {
              type: 'string',
              description: 'Complete reusable Skill system prompt.',
            },
          },
          required: ['title', 'content'],
        },
      },
    },
    systemPrompt:
      'When the Skill Creator draft is confirmed by the user, call save_skill with the final title and full content. Saving without tool success is a failure.',
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
      ctx.send({
        tool: { status: 'start', name: 'save_skill', provider: 'skills', query: 'save Skill' },
      });
      try {
        let args: { title?: string; content?: string } = {};
        try {
          args = JSON.parse(rawArguments || '{}') || {};
        } catch {}
        const title = String(args.title || '').trim().slice(0, 80);
        const content = String(args.content || '').trim();
        if (!title || !content) {
          throw new Error('save_skill requires non-empty title and content');
        }
        const res = await fetch(MAIN_SITE_BASE, {
          method: 'POST',
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
        const saved = data?.data || { id: `skill_${Date.now()}`, title, content };
        ctx.send({
          tool: {
            status: 'done',
            name: 'save_skill',
            provider: 'skills',
            query: 'save Skill',
            results: [
              {
                title: String(saved.title || title),
                url: '',
                snippet: String(saved.id || ''),
              },
            ],
          },
        });
        return {
          content: JSON.stringify({ ok: true, skill: saved }),
          data: saved,
        };
      } catch (err: any) {
        const message = String(err?.message || 'save_skill failed');
        ctx.send({
          tool: {
            status: 'done',
            name: 'save_skill',
            provider: 'skills',
            query: 'save Skill',
            error: message,
          },
        });
        return { content: JSON.stringify({ ok: false, error: message }) };
      }
    },
  };
}
