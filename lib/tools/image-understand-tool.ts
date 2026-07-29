/**
 * Image understanding ChatTool — powered by GLM-4.6V via CPA.
 *
 * The zhipu-vision MCP toggle enables *server-side* preprocess
 * (`rewriteMessagesWithImageDescriptions`), not a model-callable tool.
 * Exposing this as an OpenAI function caused follow-up questions like
 * “能识别图片吗” to re-invoke vision for no reason.
 */

import { understandImage } from '@/lib/image-understand';
import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';

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
          'Understand or describe an image (vision with OCR fallback). Pass an image URL (https or data URI) and optional instruction. Prefer using an already-injected transcription when present.',
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
    // Never expose as a model-callable tool. Uploads are transcribed server-side
    // when zhipu-vision is on; leaving this enabled makes follow-ups like
    // “能识别图片吗” re-invoke GLM-4.6V for no reason.
    systemPrompt: '',
    enabled: () => false,
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
        const userPrompt = instruction || ctx.userAsk || '';
        const result = await understandImage(
          { imageUrl, userPrompt },
          ctx.gateway,
        );
        ctx.send({
          tool: {
            status: 'done',
            name: 'image_understand',
            query,
            provider: 'zhipu-vision',
            results: result.ok
              ? [
                  {
                    title: `Image (${result.mode})`,
                    url: '',
                    snippet: result.text,
                  },
                ]
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
