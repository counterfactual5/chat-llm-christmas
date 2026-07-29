/**
 * Image understanding ChatTool — powered by GLM-4.6V via CPA.
 *
 * Two paths share this pipeline:
 * 1. Server-side preprocess (`rewriteMessagesWithImageDescriptions`) transcribes
 *    the LATEST user turn's images before the chat model runs.
 * 2. This model-callable tool covers OLDER, never-transcribed images: text-only
 *    models see them as 【历史图片引用（未转写）】 markers and may transcribe a
 *    specific one on demand. The result is persisted client-side so each image
 *    is only ever transcribed once.
 */

import { understandImage } from '@/lib/image-understand';
import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';

/** `/api/files/<id>` → bare gateway file id; other inputs unchanged. */
export function gatewayFileIdFromPath(raw: string): string {
  const s = String(raw || '').trim();
  if (!s.startsWith('/api/files/')) return '';
  return decodeURIComponent(s.slice('/api/files/'.length).split(/[?#]/)[0] || '');
}

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
  if (/^(https?:\/\/|data:)/i.test(bare) || bare.startsWith('/api/files/')) {
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
          'Look at ONE image from an EARLIER turn of this conversation that was never transcribed — those appear as 【历史图片引用（未转写）】 markers with /api/files/... paths. Pass that exact path as image_url. Do NOT call this for images whose content is already transcribed in the conversation, and do NOT call it just because the user asks whether you can see or analyze images.',
        parameters: {
          type: 'object',
          properties: {
            image_url: {
              type: 'string',
              description:
                'The /api/files/... path from a 【历史图片引用（未转写）】 marker (an https URL also works)',
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
    systemPrompt:
      'Historical images: user turns may contain a 【历史图片引用（未转写）】 marker listing /api/files/... paths of earlier uploads you have not seen. Only when answering truly requires the content of such an image, call image_understand with that path — pick only the image(s) you need. Never call it when a transcription already exists in context, and never mention the marker, tool names, or backend vision models to the user.',
    // Model-callable only for on-demand transcription of OLDER images.
    // Fresh uploads on the latest turn are transcribed server-side before the
    // chat model runs (see rewriteMessagesWithImageDescriptions).
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

      // `/api/files/<id>` markers → bare gateway file id for the vision call;
      // keep the original path in results so the client can persist the
      // transcription onto the right historical message.
      const gatewayFileId = gatewayFileIdFromPath(imageUrl);
      const visionRef = gatewayFileId || imageUrl;
      const resultUrl = imageUrl.startsWith('/api/files/') ? imageUrl : '';
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
          { imageUrl: visionRef, userPrompt },
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
                    url: resultUrl,
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
