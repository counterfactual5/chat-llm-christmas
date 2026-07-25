import OpenAI from 'openai';
import { NextRequest } from 'next/server';

export const runtime = 'edge';
export const maxDuration = 300;

function jsonError(message: string, status: number = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * GPT Image generation via the main-site gateway.
 * Bound-account only — guests cannot spend image quota.
 */
export async function POST(req: NextRequest) {
  try {
    const boundUserKey = req.cookies.get('llm_chat_api_key')?.value || '';
    if (!boundUserKey) {
      return jsonError('Image generation requires a connected llm.christmas account.', 401);
    }

    const body = await req.json();
    const prompt = String(body?.prompt || '').trim();
    const model = String(body?.model || 'gpt-image-1.5').trim();
    const size = String(body?.size || '1024x1024').trim();
    const quality = String(body?.quality || 'medium').trim();

    if (!prompt) return jsonError('Missing image prompt.', 400);
    if (prompt.length > 4000) return jsonError('Prompt is too long (max 4000 chars).', 400);

    const baseURL = (process.env.LLM_CHRISTMAS_BASE_URL || 'https://api.llm.christmas/v1').replace(
      /\/$/,
      '',
    );
    const openai = new OpenAI({ apiKey: boundUserKey, baseURL });

    // GPT Image models always return b64_json and reject `response_format`.
    const result = await openai.images.generate({
      model,
      prompt,
      n: 1,
      size: size as '1024x1024' | '1536x1024' | '1024x1536' | 'auto',
      ...(quality ? { quality: quality as 'low' | 'medium' | 'high' | 'auto' } : {}),
    } as any);

    const item = result?.data?.[0] as { b64_json?: string; url?: string; revised_prompt?: string } | undefined;
    const b64 = item?.b64_json;
    const url = item?.url;

    if (!b64 && !url) {
      return jsonError('Upstream returned no image data.', 502);
    }

    const image = b64
      ? `data:image/png;base64,${b64}`
      : String(url);

    return new Response(
      JSON.stringify({
        success: true,
        image,
        model,
        revised_prompt: item?.revised_prompt || null,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (err: any) {
    console.error('images route error:', err);
    const status = err?.status || err?.statusCode || err?.response?.status || 500;
    const detail =
      err?.error?.message || err?.message || String(err || 'Image generation failed.');
    return jsonError(`${detail}${status ? ` (HTTP ${status})` : ''}`, status >= 400 && status < 600 ? status : 500);
  }
}
