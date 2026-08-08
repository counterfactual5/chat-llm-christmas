/**
 * URL Preview — Image Understand proxy.
 *
 * Authenticates via the HttpOnly `llm_chat_api_key` cookie, then calls the
 * shared `understandImage` pipeline (GLM-4.6V → glm-ocr) so the panel can
 * describe an extracted `![alt](https://…)` image on demand.
 *
 * Unlike the chat-turn rewrite path, this endpoint describes ONE image URL
 * per call and returns the plain-text description directly to the panel.
 */

import { NextRequest } from 'next/server';
import { understandImage } from '@/lib/tools/image-understand';
import { filesGatewayBaseURL } from '@/lib/files/gateway';

export const runtime = 'edge';
export const maxDuration = 30;

const URL_PREVIEW_IMAGE_PROMPT =
  '描述这张图片的内容。如果它是论文插图、图表或截图，请重点提取其中的文字、数据标签、坐标轴、图例和主要结论，不要只描述外观。如果图片含公式，请用 LaTeX 转写。';

const REQUEST_TIMEOUT_MS = 24_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function POST(req: NextRequest) {
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }
  const apiKey = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!apiKey) {
    return json({ ok: false, error: '请先连接主站账号' }, 401);
  }

  let body: { imageUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  const imageUrl = String(body?.imageUrl || '').trim();
  if (!imageUrl) {
    return json({ ok: false, error: 'Missing imageUrl' }, 400);
  }
  if (!/^https?:\/\//i.test(imageUrl)) {
    return json({ ok: false, error: 'imageUrl must be http(s)' }, 400);
  }

  const baseURL = filesGatewayBaseURL();

  try {
    const result = await withTimeout(
      understandImage(
        { imageUrl, userPrompt: URL_PREVIEW_IMAGE_PROMPT },
        { apiKey, baseURL },
      ),
      REQUEST_TIMEOUT_MS,
    );
    if (!result.ok) {
      return json(
        { ok: false, error: result.text || 'Image understanding failed' },
        502,
      );
    }
    return json({
      ok: true,
      text: result.text,
      mode: result.mode,
      provider: result.provider || 'image-understand',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/timeout/i.test(message)) {
      return json({ ok: false, error: 'Image understanding timed out' }, 504);
    }
    return json({ ok: false, error: message }, 502);
  }
}
