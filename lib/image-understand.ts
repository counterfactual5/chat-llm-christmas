/**
 * Image understanding via GLM-4.6V through CPA gateway.
 *
 * Priority: vision understanding/description → OCR fallback.
 * Uses the same CPA endpoint + user API key so costs are billed to the user.
 */

import OpenAI from 'openai';
import { toImageContentPart } from '@/lib/gateway-files';

export const IMAGE_UNDERSTAND_MODEL = 'glm-4.6v';
const UNDERSTAND_TIMEOUT_MS = 30_000;
/** Cap description injected into the text-model prompt (chars). */
const MAX_DESCRIPTION_CHARS = 4_000;

export interface ImageUnderstandInput {
  /** Image URL (https / data URI) or gateway file id. */
  imageUrl: string;
  /** Optional user instruction for the vision model. */
  instruction?: string;
}

export interface ImageUnderstandResult {
  ok: boolean;
  /** Text description / understanding of the image. */
  text: string;
  /** Which mode produced the result. */
  mode: 'understand' | 'ocr' | 'error';
}

function toVisionImagePart(imageUrl: string): Record<string, unknown> | null {
  const raw = String(imageUrl || '').trim();
  if (!raw) return null;
  // Prefer gateway file-id resolution when callers pass /api/files/... or bare ids.
  const part = toImageContentPart(
    raw.startsWith('http') || raw.startsWith('data:')
      ? { url: raw }
      : { fileId: raw, url: raw },
  );
  return part;
}

async function callVision(
  client: OpenAI,
  imagePart: Record<string, unknown>,
  text: string,
): Promise<string> {
  const res = await withTimeout(
    client.chat.completions.create({
      model: IMAGE_UNDERSTAND_MODEL,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text }, imagePart] as any,
        },
      ],
      max_tokens: 2048,
    }),
    UNDERSTAND_TIMEOUT_MS,
  );
  return String(res.choices?.[0]?.message?.content || '').trim();
}

/**
 * Call GLM-4.6V to understand an image. Falls back to OCR-style prompt on failure.
 */
export async function understandImage(
  input: ImageUnderstandInput,
  gateway: { apiKey: string; baseURL: string },
): Promise<ImageUnderstandResult> {
  const imagePart = toVisionImagePart(input.imageUrl);
  if (!imagePart) {
    return { ok: false, text: 'Invalid image URL.', mode: 'error' };
  }

  const client = new OpenAI({
    apiKey: gateway.apiKey,
    baseURL: gateway.baseURL,
  });

  const userInstruction =
    input.instruction?.trim() ||
    '请详细描述这张图片的内容，包括主要元素、场景、文字、数据等关键信息。';

  // Attempt 1: understanding / description
  try {
    const text = await callVision(client, imagePart, userInstruction);
    if (text) return { ok: true, text, mode: 'understand' };
  } catch (err) {
    console.warn('image-understand: vision call failed, trying OCR fallback', err);
  }

  // Attempt 2: OCR fallback — ask specifically for text extraction
  try {
    const text = await callVision(
      client,
      imagePart,
      '请提取这张图片中的所有文字内容。如果没有文字，请描述图片的主要内容。',
    );
    if (text) return { ok: true, text, mode: 'ocr' };
  } catch (err) {
    console.warn('image-understand: OCR fallback also failed', err);
  }

  return {
    ok: false,
    text: 'Failed to understand the image. Please try a vision-capable model for best results.',
    mode: 'error',
  };
}

/**
 * Replace image_url parts in chat messages with text descriptions from GLM-4.6V.
 * Used when the selected chat model is text-only but zhipu-vision MCP is on.
 */
export async function rewriteMessagesWithImageDescriptions(
  messages: any[],
  gateway: { apiKey: string; baseURL: string },
  opts?: { send?: (payload: Record<string, unknown>) => void },
): Promise<any[]> {
  const out: any[] = [];
  let imageIndex = 0;

  for (const msg of messages) {
    if (!Array.isArray(msg?.content)) {
      out.push(msg);
      continue;
    }

    const nextParts: any[] = [];
    let changed = false;

    for (const part of msg.content) {
      if (!part || part.type !== 'image_url') {
        nextParts.push(part);
        continue;
      }

      const url = String(part?.image_url?.url || part?.url || '').trim();
      if (!url) {
        nextParts.push(part);
        continue;
      }

      imageIndex += 1;
      const label = `Image ${imageIndex}`;
      opts?.send?.({
        tool: {
          status: 'start',
          name: 'image_understand',
          query: label,
          provider: 'zhipu-vision',
        },
      });

      const result = await understandImage({ imageUrl: url }, gateway);
      const description = result.ok
        ? result.text.length > MAX_DESCRIPTION_CHARS
          ? `${result.text.slice(0, MAX_DESCRIPTION_CHARS)}\n…(truncated)`
          : result.text
        : result.text;
      // Never put data:/file urls into results — UI treats them as Reference Material
      // links and would dump megabyte base64 into the next request's context.
      opts?.send?.({
        tool: {
          status: 'done',
          name: 'image_understand',
          query: label,
          provider: 'zhipu-vision',
          results: result.ok
            ? [
                {
                  title: `${label} (${result.mode})`,
                  url: '',
                  snippet: description.slice(0, 400),
                },
              ]
            : [],
          error: result.ok ? undefined : result.text,
        },
      });

      nextParts.push({
        type: 'text',
        text: result.ok
          ? `【${label} 图像理解 / ${result.mode}】\n${description}`
          : `【${label} 图像理解失败】${description}`,
      });
      changed = true;
    }

    if (!changed) {
      out.push(msg);
    } else {
      // Collapse adjacent text parts for cleaner prompts.
      const collapsed: any[] = [];
      for (const p of nextParts) {
        const last = collapsed[collapsed.length - 1];
        if (p?.type === 'text' && last?.type === 'text') {
          last.text = `${last.text}\n\n${p.text}`;
        } else {
          collapsed.push(p);
        }
      }
      if (collapsed.length === 1 && collapsed[0]?.type === 'text') {
        out.push({ ...msg, content: collapsed[0].text });
      } else {
        out.push({ ...msg, content: collapsed });
      }
    }
  }

  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
