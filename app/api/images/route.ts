import OpenAI from 'openai';
import { NextRequest } from 'next/server';
import {
  gatewayBaseURL,
  uploadGatewayBase64Png,
  uploadGatewayFile,
} from '@/lib/gateway-files';

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
 * Uploads the result to Files API and returns a reusable file id.
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

    const baseURL = gatewayBaseURL();
    const openai = new OpenAI({ apiKey: boundUserKey, baseURL });

    // GPT Image models always return b64_json and reject `response_format`.
    const result = await openai.images.generate({
      model,
      prompt,
      n: 1,
      size: size as '1024x1024' | '1536x1024' | '1024x1536' | 'auto',
      ...(quality ? { quality: quality as 'low' | 'medium' | 'high' | 'auto' } : {}),
    } as any);

    const item = result?.data?.[0] as
      | { b64_json?: string; url?: string; revised_prompt?: string }
      | undefined;
    const b64 = item?.b64_json;
    const remoteUrl = item?.url;

    if (!b64 && !remoteUrl) {
      return jsonError('Upstream returned no image data.', 502);
    }

    let fileId: string | null = null;
    let image = b64 ? `data:image/png;base64,${b64}` : String(remoteUrl);

    try {
      if (b64) {
        const uploaded = await uploadGatewayBase64Png({
          apiKey: boundUserKey,
          baseURL,
          b64,
          filename: `gen-${Date.now()}.png`,
        });
        fileId = uploaded.id;
        image = `/api/files/${encodeURIComponent(uploaded.id)}`;
      } else if (remoteUrl) {
        const fetched = await fetch(String(remoteUrl));
        if (fetched.ok) {
          const bytes = new Uint8Array(await fetched.arrayBuffer());
          const uploaded = await uploadGatewayFile({
            apiKey: boundUserKey,
            baseURL,
            bytes,
            filename: `gen-${Date.now()}.png`,
            mime: fetched.headers.get('content-type') || 'image/png',
          });
          fileId = uploaded.id;
          image = `/api/files/${encodeURIComponent(uploaded.id)}`;
        }
      }
    } catch (uploadErr) {
      console.error('images file upload failed, keeping inline fallback:', uploadErr);
      if (b64) image = `data:image/png;base64,${b64}`;
    }

    return new Response(
      JSON.stringify({
        success: true,
        image,
        fileId,
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
    return jsonError(
      `${detail}${status ? ` (HTTP ${status})` : ''}`,
      status >= 400 && status < 600 ? status : 500,
    );
  }
}
