/**
 * Image understanding via GLM-4.6V through CPA gateway.
 *
 * Vision model runs with a system prompt (enough detail for the text model, aligned with the
 * user's chat message). The text-only chat model receives that transcription instead of pixels.
 */

import OpenAI from 'openai';
import { toImageContentPart } from '@/lib/gateway-files';

export const IMAGE_UNDERSTAND_MODEL = 'glm-4.6v';
const UNDERSTAND_TIMEOUT_MS = 30_000;

export interface ImageUnderstandInput {
  /** Image URL (https / data URI) or gateway file id. */
  imageUrl: string;
  /**
   * The user's chat text for this turn (or tool instruction).
   * Drives what the vision model should focus on (OCR, objects, etc.).
   */
  userPrompt?: string;
  /** @deprecated Use userPrompt */
  instruction?: string;
}

export interface ImageUnderstandResult {
  ok: boolean;
  /** Plain-text description for the text-only chat model. */
  text: string;
  mode: 'understand' | 'ocr' | 'error';
}

function toVisionImagePart(imageUrl: string): Record<string, unknown> | null {
  const raw = String(imageUrl || '').trim();
  if (!raw) return null;
  const part = toImageContentPart(
    raw.startsWith('http') || raw.startsWith('data:')
      ? { url: raw }
      : { fileId: raw, url: raw },
  );
  return part;
}

export function buildImageUnderstandSystemPrompt(userPrompt: string): string {
  const focus = userPrompt.trim();
  const intentBlock = focus
    ? focus
    : '（用户未附带文字 — 请按开放式描述处理：按区域写清主要场景/界面与关键可见文字。）';

  return [
    '你是图像理解助手。下游是文本模型，看不到像素，只能靠你的转写作答。',
    '',
    '输出要求：',
    '- 纯文本；可用简短编号分点，不要长篇开场白，不要复述用户原话。',
    '- 信息要够用：开放式问题（如「有什么」「描述一下」）按区域写清主要 UI/场景、关键可见文字与布局关系；具体问题（读字、读数、找某物）紧扣问题，可更详细。',
    '- 可见文字尽量原样转录；看不清就写「模糊/不可辨」。',
    '- 不要臆造图中没有的内容；不要评论「这是截图」「用户在问什么」。',
    '',
    '用户消息（看图时以此为意图）：',
    intentBlock,
  ].join('\n');
}

const OCR_RETRY_SYSTEM = [
  '你是图像 OCR 助手。只输出图片中可见文字的纯文本转录，保持原有换行。',
  '若无文字，用一两句话概括图片。不要 Markdown，不要解释。',
].join('\n');

async function callVision(
  client: OpenAI,
  imagePart: Record<string, unknown>,
  system: string,
): Promise<string> {
  const res = await withTimeout(
    client.chat.completions.create({
      model: IMAGE_UNDERSTAND_MODEL,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [{ type: 'text', text: '请根据系统说明观察这张图片。' }, imagePart] as any,
        },
      ],
    }),
    UNDERSTAND_TIMEOUT_MS,
  );
  return String(res.choices?.[0]?.message?.content || '').trim();
}

/**
 * Call GLM-4.6V with system prompt + user image. Output is plain text for the chat model.
 */
export async function understandImage(
  input: ImageUnderstandInput,
  gateway: { apiKey: string; baseURL: string },
): Promise<ImageUnderstandResult> {
  const imagePart = toVisionImagePart(input.imageUrl);
  if (!imagePart) {
    return { ok: false, text: 'Invalid image URL.', mode: 'error' };
  }

  const userPrompt = (input.userPrompt || input.instruction || '').trim();

  const client = new OpenAI({
    apiKey: gateway.apiKey,
    baseURL: gateway.baseURL,
  });

  const system = buildImageUnderstandSystemPrompt(userPrompt);

  try {
    const text = await callVision(client, imagePart, system);
    if (text) return { ok: true, text, mode: 'understand' };
  } catch (err) {
    console.warn('image-understand: vision call failed, trying OCR fallback', err);
  }

  try {
    const text = await callVision(client, imagePart, OCR_RETRY_SYSTEM);
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

function textPartsFromMessageContent(parts: any[]): string {
  return parts
    .filter((p) => p && p.type === 'text')
    .map((p) => String(p.text || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

function formatInjectionText(description: string): string {
  return [
    '以下是图片内容（由视觉模型转写，请当作你已看到该图，直接据此回答用户；不要解释这段转写本身，也不要复述「Image description」标签）：',
    description,
  ].join('\n');
}

/**
 * Replace image_url parts with plain-text descriptions from GLM-4.6V.
 */
export async function rewriteMessagesWithImageDescriptions(
  messages: any[],
  gateway: { apiKey: string; baseURL: string },
  opts?: {
    send?: (payload: Record<string, unknown>) => void;
    /** Last user text in thread — used when a turn is image-only. */
    userAsk?: string;
  },
): Promise<any[]> {
  const out: any[] = [];
  let imageIndex = 0;

  for (const msg of messages) {
    if (msg?.role === 'system' || !Array.isArray(msg?.content)) {
      out.push(msg);
      continue;
    }

    const turnPrompt =
      textPartsFromMessageContent(msg.content) || String(opts?.userAsk || '').trim();

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
          query: turnPrompt ? turnPrompt.slice(0, 120) : label,
          provider: 'zhipu-vision',
        },
      });

      const result = await understandImage(
        { imageUrl: url, userPrompt: turnPrompt },
        gateway,
      );
      const description = result.text;

      opts?.send?.({
        tool: {
          status: 'done',
          name: 'image_understand',
          query: turnPrompt ? turnPrompt.slice(0, 120) : label,
          provider: 'zhipu-vision',
          results: result.ok
            ? [
                {
                  title: label,
                  url: '',
                  snippet: description,
                },
              ]
            : [],
          error: result.ok ? undefined : description,
        },
      });

      nextParts.push({
        type: 'text',
        text: result.ok
          ? formatInjectionText(description)
          : `[Image understanding failed] ${description}`,
      });
      changed = true;
    }

    if (!changed) {
      out.push(msg);
    } else {
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
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
