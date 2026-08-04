/**
 * Model-callable generate_image tool.
 * Same gateway path as `/image` command; shows under Process via tool start/done.
 */

import { gatewayBaseURL } from '@/lib/files/gateway';
import { generateAndStoreImage } from '@/lib/images/generate-and-store';
import type { ChatTool } from '@/lib/tools/registry';

const SYSTEM_PROMPT = [
  'You have a generate_image tool that creates an image via the image model and saves it to this chat.',
  'Call it when the user asks to draw/generate/create an image (or clearly wants a picture of something).',
  'Pass a clear English or Chinese visual prompt. Do not claim an image was generated unless the tool returned ok:true.',
  'The user can always force generation with the /image slash command (does not need this tool to be ON).',
].join(' ');

function parsePrompt(rawArguments: string, fallback: string): string {
  try {
    const args = JSON.parse(rawArguments || '{}') || {};
    const p = String(args.prompt || args.query || '').trim();
    if (p) return p.slice(0, 4000);
  } catch {
    const bare = String(rawArguments || '')
      .replace(/^["']|["']$/g, '')
      .trim();
    if (bare) return bare.slice(0, 4000);
  }
  return String(fallback || '')
    .trim()
    .slice(0, 4000);
}

export function createGenerateImageTool(): ChatTool {
  return {
    name: 'generate_image',
    definition: {
      type: 'function',
      function: {
        name: 'generate_image',
        description:
          'Generate an image from a text prompt and attach it to this chat. Use when the user wants a picture drawn/created.',
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Visual description of the image to generate.',
            },
          },
          required: ['prompt'],
        },
      },
    },
    systemPrompt: SYSTEM_PROMPT,
    enabled: (flags) => flags.integrations.includes('generate_image'),
    async execute({ rawArguments, fallbackQuery }, ctx) {
      const prompt = parsePrompt(rawArguments, fallbackQuery || ctx.userAsk);
      if (!prompt) {
        const error = 'generate_image requires a prompt';
        ctx.send({ tool: { status: 'done', name: 'generate_image', error } });
        return { content: JSON.stringify({ ok: false, error }) };
      }

      const apiKey = ctx.gateway?.apiKey || ctx.credentials?.skillsApiKey;
      const baseURL = ctx.gateway?.baseURL || gatewayBaseURL();
      if (!apiKey || !baseURL) {
        const error = 'Image generation requires a connected account';
        ctx.send({
          tool: { status: 'done', name: 'generate_image', query: prompt, error },
        });
        return { content: JSON.stringify({ ok: false, error }) };
      }

      ctx.send({
        tool: { status: 'start', name: 'generate_image', query: prompt, provider: 'gpt-image' },
      });

      try {
        const stored = await generateAndStoreImage({
          apiKey,
          baseURL,
          prompt,
        });

        ctx.send({
          image_generated: {
            url: stored.image,
            fileId: stored.fileId,
            prompt,
            model: stored.model,
          },
        });
        ctx.send({
          tool: {
            status: 'done',
            name: 'generate_image',
            query: prompt,
            provider: 'gpt-image',
            results: [
              {
                title: prompt.slice(0, 80),
                url: stored.image,
                snippet: `file ${stored.fileId}`,
              },
            ],
          },
        });
        return {
          content: JSON.stringify({
            ok: true,
            prompt,
            fileId: stored.fileId,
            url: stored.image,
          }),
        };
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : 'Image generation failed';
        ctx.send({
          tool: {
            status: 'done',
            name: 'generate_image',
            query: prompt,
            provider: 'gpt-image',
            error,
          },
        });
        return { content: JSON.stringify({ ok: false, error }) };
      }
    },
  };
}
