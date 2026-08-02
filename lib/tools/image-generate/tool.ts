/**
 * Model-callable generate_image tool.
 * Same gateway path as `/image` command; shows under Process via tool start/done.
 */

import OpenAI from 'openai';
import {
  filesGatewayBaseURL,
  uploadGatewayBase64Png,
  uploadGatewayFile,
} from '@/lib/files/gateway';
import type { ChatTool } from '@/lib/tools/registry';

const SYSTEM_PROMPT = [
  'You have a generate_image tool that creates an image via the image model and saves it to this chat.',
  'Call it when the user asks to draw/generate/create an image (or clearly wants a picture of something).',
  'Pass a clear English or Chinese visual prompt. Do not claim an image was generated unless the tool returned ok:true.',
  'The user can also force generation with the /image slash command.',
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
    enabled: () => true,
    async execute({ rawArguments, fallbackQuery }, ctx) {
      const prompt = parsePrompt(rawArguments, fallbackQuery || ctx.userAsk);
      if (!prompt) {
        const error = 'generate_image requires a prompt';
        ctx.send({ tool: { status: 'done', name: 'generate_image', error } });
        return { content: JSON.stringify({ ok: false, error }) };
      }

      const apiKey = ctx.gateway?.apiKey || ctx.credentials?.skillsApiKey;
      const baseURL = ctx.gateway?.baseURL;
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
        const openai = new OpenAI({ apiKey, baseURL });
        const result = (await openai.images.generate({
          model: 'gpt-image-1.5',
          prompt,
          n: 1,
          size: '1024x1024',
          quality: 'medium',
        } as any)) as {
          data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
        };
        const item = result?.data?.[0];
        const b64 = item?.b64_json;
        const remoteUrl = item?.url;
        if (!b64 && !remoteUrl) {
          throw new Error('Upstream returned no image data');
        }

        const filesBaseURL = filesGatewayBaseURL();
        const filesModel =
          String(process.env.LLM_CHRISTMAS_FILE_MODEL || 'gpt-4o').trim() || 'gpt-4o';
        let fileId = '';
        let image = '';

        if (b64) {
          const uploaded = await uploadGatewayBase64Png({
            apiKey,
            baseURL: filesBaseURL,
            b64,
            filename: `gen-${Date.now()}.png`,
            model: filesModel,
          });
          fileId = uploaded.id;
          image = `/api/files/${encodeURIComponent(uploaded.id)}`;
        } else if (remoteUrl) {
          const fetched = await fetch(String(remoteUrl));
          if (!fetched.ok) {
            throw new Error(`Failed to fetch generated image URL (HTTP ${fetched.status})`);
          }
          const bytes = new Uint8Array(await fetched.arrayBuffer());
          const uploaded = await uploadGatewayFile({
            apiKey,
            baseURL: filesBaseURL,
            bytes,
            filename: `gen-${Date.now()}.png`,
            mime: fetched.headers.get('content-type') || 'image/png',
            model: filesModel,
          });
          fileId = uploaded.id;
          image = `/api/files/${encodeURIComponent(uploaded.id)}`;
        }

        ctx.send({
          image_generated: {
            url: image,
            fileId,
            prompt,
            model: 'gpt-image-1.5',
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
                url: image,
                snippet: fileId ? `file ${fileId}` : 'generated image',
              },
            ],
          },
        });
        return {
          content: JSON.stringify({
            ok: true,
            prompt,
            fileId,
            image,
            revised_prompt: item?.revised_prompt || null,
          }),
        };
      } catch (err) {
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
