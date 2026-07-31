import OpenAI from 'openai';
import { NextRequest } from 'next/server';
import {
  gatewayBaseURL,
  uploadGatewayBase64Png,
  uploadGatewayFile,
} from '@/lib/gateway-files';

// Image b64 payloads are large — Node has more headroom than Edge for this route.
export const runtime = 'nodejs';
export const maxDuration = 300;

function jsonError(message: string, status: number = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function upstreamErrorMessage(err: unknown): { detail: string; status: number } {
  const e = err as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
    error?: { message?: string };
    message?: string;
  } | null;
  const status = Number(e?.status || e?.statusCode || e?.response?.status || 500);
  let detail =
    e?.error?.message || e?.message || String(err || 'Image generation failed.');
  // OpenAI SDK sometimes embeds a non-JSON upstream body in message — keep it short.
  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 500);
  return {
    detail,
    status: status >= 400 && status < 600 ? status : 500,
  };
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

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonError('Invalid JSON body.', 400);
    }

    const prompt = String(body?.prompt || '').trim();
    const model = String(body?.model || 'gpt-image-1.5').trim();
    const size = String(body?.size || '1024x1024').trim();
    const quality = String(body?.quality || 'medium').trim();

    if (!prompt) return jsonError('Missing image prompt.', 400);
    if (prompt.length > 4000) return jsonError('Prompt is too long (max 4000 chars).', 400);

    const baseURL = gatewayBaseURL();
    const openai = new OpenAI({ apiKey: boundUserKey, baseURL });

    // GPT Image models always return b64_json and reject `response_format`.
    let result: {
      data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
    };
    try {
      result = (await openai.images.generate({
        model,
        prompt,
        n: 1,
        size: size as '1024x1024' | '1536x1024' | '1024x1536' | 'auto',
        ...(quality ? { quality: quality as 'low' | 'medium' | 'high' | 'auto' } : {}),
      } as any)) as typeof result;
    } catch (genErr) {
      const { detail, status } = upstreamErrorMessage(genErr);
      console.error('images.generate failed:', status, detail);
      return jsonError(detail, status);
    }

    const item = result?.data?.[0];
    const b64 = item?.b64_json;
    const remoteUrl = item?.url;

    if (!b64 && !remoteUrl) {
      return jsonError('Upstream returned no image data.', 502);
    }

    let fileId: string | null = null;
    let image = '';

    // Files upload is mandatory now: sessions sync cross-device via file refs,
    // so inline data URLs are no longer an acceptable fallback. Query param +
    // a chat routing model keep compatibility with NewAPI-style distributors.
    const filesModel =
      String(process.env.LLM_CHRISTMAS_FILE_MODEL || 'gpt-4o').trim() || 'gpt-4o';

    try {
      if (b64) {
        const uploaded = await uploadGatewayBase64Png({
          apiKey: boundUserKey,
          baseURL,
          b64,
          filename: `gen-${Date.now()}.png`,
          model: filesModel,
        });
        fileId = uploaded.id;
        image = `/api/files/${encodeURIComponent(uploaded.id)}`;
      } else if (remoteUrl) {
        const fetched = await fetch(String(remoteUrl));
        if (!fetched.ok) {
          return jsonError(`Failed to fetch generated image URL (HTTP ${fetched.status}).`, 502);
        }
        const bytes = new Uint8Array(await fetched.arrayBuffer());
        const uploaded = await uploadGatewayFile({
          apiKey: boundUserKey,
          baseURL,
          bytes,
          filename: `gen-${Date.now()}.png`,
          mime: fetched.headers.get('content-type') || 'image/png',
          model: filesModel,
        });
        fileId = uploaded.id;
        image = `/api/files/${encodeURIComponent(uploaded.id)}`;
      }
    } catch (uploadErr) {
      console.error('images file upload failed:', uploadErr);
      const { detail } = upstreamErrorMessage(uploadErr);
      return jsonError(
        `Image was generated but saving to Files API failed: ${detail}`,
        502,
      );
    }

    if (!image || !fileId) {
      return jsonError('Image was generated but no file id was saved.', 502);
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
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  } catch (err: unknown) {
    console.error('images route error:', err);
    const { detail, status } = upstreamErrorMessage(err);
    return jsonError(detail, status);
  }
}
