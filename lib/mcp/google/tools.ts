import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';
import { calendarToolDefs } from '@/lib/mcp/google/calendar';
import { driveToolDefs } from '@/lib/mcp/google/drive';
import { gmailToolDefs } from '@/lib/mcp/google/gmail';
import {
  extractUiResults,
  googleToken,
  queryHint,
  requireObjectArgs,
  serviceSystemPrompt,
  toolService,
  type GoogleToolDef,
} from '@/lib/mcp/google/shared';

const TOOL_DEFS: GoogleToolDef[] = [
  ...gmailToolDefs,
  ...calendarToolDefs,
  ...driveToolDefs,
];

function makeTool(def: GoogleToolDef): ChatTool {
  return {
    name: def.name,
    definition: {
      type: 'function',
      function: {
        name: def.name,
        description: def.description.slice(0, 1024),
        parameters: def.parameters,
      },
    },
    systemPrompt: serviceSystemPrompt(toolService(def.name)),
    enabled: (flags) => flags.integrations.includes(toolService(def.name)),
    async execute({ rawArguments, fallbackQuery }, ctx) {
      const token = googleToken(ctx);
      if (!token) {
        return {
          content: JSON.stringify({
            ok: false,
            error: 'Google Workspace is not connected for this account.',
          }),
        };
      }

      let args: Record<string, unknown>;
      try {
        args = requireObjectArgs(rawArguments);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Incomplete or invalid tool arguments JSON';
        return { content: JSON.stringify({ ok: false, error: message }) };
      }
      const fallback = String(fallbackQuery || ctx.userAsk || '').trim().slice(0, 200);
      const query = queryHint(def.name, args);
      const write = Boolean(def.write);

      ctx.send({
        tool: {
          status: 'start',
          name: def.name,
          query,
          provider: 'google',
          write,
        },
      });

      try {
        const result = await def.run(token, args, fallback);
        const results = extractUiResults(def.name, result);
        ctx.send({
          tool: {
            status: 'done',
            name: def.name,
            query,
            provider: 'google',
            write,
            results,
          },
        });
        return { content: JSON.stringify(result) };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : String(err || 'Google API call failed');
        ctx.send({
          tool: {
            status: 'done',
            name: def.name,
            query,
            provider: 'google',
            write,
            results: [],
            error: message,
          },
        });
        return { content: JSON.stringify({ ok: false, error: message }) };
      }
    },
  };
}

/** Register curated Gmail / Calendar / Drive REST tools for the chat model. */
export async function createGoogleTools(
  _accessToken: string,
  integrations: string[] = ['gmail', 'calendar', 'drive'],
): Promise<ChatTool[]> {
  // Token is validated per-call via runtime credentials; presence here means Google is authorized.
  const enabled = new Set(
    integrations
      .map((id) => String(id || '').trim().toLowerCase())
      .filter((id) => id === 'gmail' || id === 'calendar' || id === 'drive'),
  );
  // Legacy single toggle.
  if (integrations.map((id) => String(id || '').trim().toLowerCase()).includes('google')) {
    enabled.add('gmail');
    enabled.add('calendar');
    enabled.add('drive');
  }
  return TOOL_DEFS.filter((def) => enabled.has(toolService(def.name))).map(makeTool);
}

/** @deprecated Prefer createGoogleTools — kept for existing imports. */
export const createGoogleMcpTools = createGoogleTools;
