import { NextRequest } from 'next/server';
import { gatewayBaseURL } from '@/lib/files/gateway';
import { generateAndStoreImage } from '@/lib/images/generate-and-store';

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

    try {
      const stored = await generateAndStoreImage({
        apiKey: boundUserKey,
        baseURL: gatewayBaseURL(),
        prompt,
        model,
        size,
        quality,
      });

      return new Response(
        JSON.stringify({
          success: true,
          image: stored.image,
          fileId: stored.fileId,
          model: stored.model,
          revised_prompt: stored.revised_prompt,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        },
      );
    } catch (genErr) {
      const { detail, status } = upstreamErrorMessage(genErr);
      console.error('images.generate failed:', status, detail);
      // Distinguish generate vs upload failures for the client when possible.
      const msg = String(detail || '');
      if (/saving to Files|file id|upload/i.test(msg)) {
        return jsonError(
          msg.startsWith('Image was generated')
            ? msg
            : `Image was generated but saving to Files API failed: ${detail}`,
          502,
        );
      }
      return jsonError(detail, status);
    }
  } catch (err: unknown) {
    const { detail, status } = upstreamErrorMessage(err);
    console.error('images route failed:', err);
    return jsonError(detail, status);
  }
}
