/**
 * Image understanding ChatTool — powered by GLM-4.6V via CPA.
 *
 * Enabled when the user toggles `zhipu-vision` in the MCP panel.
 * Costs are billed to the user's CPA balance (same apiKey as chat).
 */

import { understandImage } from '@/lib/image-understand';
import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';

const SYSTEM_PROMPT = [
  'You have an image_understand tool powered by GLM-4.6V.',
  'When the conversation contains images that you cannot see directly (text-only model),',
  'the server may already have injected image descriptions — use those.',
  'Call image_understand if you need a fresh / more detailed analysis of a specific image URL.',
  'Do not invent image contents — only use tool results or injected descriptions.',
].join(' ');

export function parseImageUnderstandArgs(
  rawArgs: string,
  fallback: string,
): { imageUrl: string; instruction: string } {
  try {
    const args = JSON.parse(rawArgs || '{}');
    const imageUrl = String(
      args?.image_url || args?.imageUrl || args?.url || args?.image || '',
    ).trim();
    const instruction = String(args?.instruction || args?.prompt || args?.query || '').trim();
    if (imageUrl) return { imageUrl, instruction };
  } catch {
    // fall through
  }
  const bare = String(rawArgs || fallback || '').trim();
  if (/^(https?:\/\/|data:)/i.test(bare)) {
    return { imageUrl: bare, instruction: '' };
  }
  return { imageUrl: '', instruction: bare };
}

export function createImageUnderstandTool(): ChatTool {
  return {
    name: 'image_understand',
    definition: {
      type: 'function',
      function: {
        name: 'image_understand',
        description:
          'Understand / describe an image using GLM-4.6V (vision → OCR fallback). Pass an image URL (https or data URI) and optional instruction.',
        parameters: {
          type: 'object',
          properties: {
            image_url: {
              type: 'string',
              description: 'HTTPS URL or data URI of the image to understand',
            },
            instruction: {
              type: 'string',
              description:
                'Optional focus for the analysis (e.g. "extract all text", "describe the chart")',
            },
          },
          required: ['image_url'],
        },
      },
    },
    systemPrompt: SYSTEM_PROMPT,
    enabled: (flags) => flags.integrations.includes('zhipu-vision'),
    async execute({ rawArguments, fallbackQuery }, ctx) {
      const { imageUrl, instruction } = parseImageUnderstandArgs(
        rawArguments,
        fallbackQuery || ctx.userAsk,
      );

      if (!imageUrl) {
        return {
          content: JSON.stringify({
            ok: false,
            error: 'image_url is required',
          }),
        };
      }

      if (!ctx.gateway?.apiKey || !ctx.gateway?.baseURL) {
        return {
          content: JSON.stringify({
            ok: false,
            error: 'Image understanding requires a logged-in account with CPA access.',
          }),
        };
      }

      const query = instruction || imageUrl.slice(0, 80);
      ctx.send({
        tool: {
          status: 'start',
          name: 'image_understand',
          query,
          provider: 'zhipu-vision',
        },
      });

      try {
        const result = await understandImage(
          { imageUrl, instruction: instruction || undefined },
          ctx.gateway,
        );
        ctx.send({
          tool: {
            status: 'done',
            name: 'image_understand',
            query,
            provider: 'zhipu-vision',
            results: result.ok
              ? [{ title: `Image (${result.mode})`, url: imageUrl, snippet: result.text.slice(0, 240) }]
              : [],
            error: result.ok ? undefined : result.text,
          },
        });
        return { content: JSON.stringify(result), data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err || 'failed');
        ctx.send({
          tool: {
            status: 'done',
            name: 'image_understand',
            query,
            provider: 'zhipu-vision',
            results: [],
            error: message,
          },
        });
        return { content: JSON.stringify({ ok: false, error: message, mode: 'error' }) };
      }
    },
  };
}
