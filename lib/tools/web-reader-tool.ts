import {
  WEB_READ_TOOL,
  formatWebReadForModel,
  webRead,
  type WebReadOutcome,
} from '@/lib/web-reader';
import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';

export function parseReadUrl(rawArgs: string, fallback: string): string {
  try {
    const args = JSON.parse(rawArgs || '{}');
    const u = String(args?.url || args?.link || args?.href || '').trim();
    if (u) return u;
  } catch {
    const bare = rawArgs.replace(/^["']|["']$/g, '').trim();
    if (/^https?:\/\//i.test(bare)) return bare;
  }
  const fromFallback = String(fallback || '').trim();
  if (/^https?:\/\//i.test(fromFallback)) return fromFallback;
  return '';
}

export async function runWebRead(
  url: string,
  ctx: ToolRuntimeContext,
): Promise<WebReadOutcome> {
  const target = String(url || '').trim();
  ctx.send({
    tool: {
      status: 'start',
      name: 'web_read',
      query: target,
      provider: 'web',
    },
  });
  const outcome = await webRead(target);
  ctx.send({
    tool: {
      status: 'done',
      name: 'web_read',
      query: outcome.url || target,
      provider: outcome.provider,
      results: outcome.content
        ? [
            {
              title: outcome.title || outcome.url || target,
              url: outcome.url || target,
              snippet: outcome.content.slice(0, 240),
            },
          ]
        : [],
      error: outcome.error,
    },
  });
  return outcome;
}

const WEB_READ_SYSTEM_PROMPT = [
  'You also have a web_read tool to fetch the full text of a specific public URL.',
  'Typical flow: web_search to find links, then web_read on 1–3 promising URLs when snippets are insufficient.',
  'Call web_read when the user pastes a link and asks you to summarize or extract details from that page.',
  'Do not invent page contents — only use what web_read returns.',
].join(' ');

export function createWebReadTool(): ChatTool {
  return {
    name: 'web_read',
    definition: WEB_READ_TOOL,
    systemPrompt: WEB_READ_SYSTEM_PROMPT,
    enabled: (flags) => flags.searchEnabled,
    async execute({ rawArguments, fallbackQuery }, ctx) {
      const url = parseReadUrl(rawArguments, fallbackQuery || ctx.userAsk);
      const outcome = await runWebRead(url, ctx);
      return {
        content: formatWebReadForModel(outcome),
        data: outcome,
      };
    },
  };
}
