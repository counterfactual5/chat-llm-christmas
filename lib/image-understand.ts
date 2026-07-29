/**
 * Image understanding via GLM-4.6V through CPA gateway.
 *
 * Vision model runs with a system prompt (enough detail for the text model, aligned with the
 * user's chat message). Multiple images in the same turn are sent in one request when possible.
 * The text-only chat model receives that transcription instead of pixels.
 */

import OpenAI from 'openai';
import { toImageContentPart } from '@/lib/gateway-files';

export const IMAGE_UNDERSTAND_MODEL = 'glm-4.6v';
const UNDERSTAND_TIMEOUT_MS = 45_000;
const BATCH_TIMEOUT_CAP_MS = 90_000;

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

export function buildImageUnderstandSystemPrompt(
  userPrompt: string,
  imageCount = 1,
): string {
  const focus = userPrompt.trim();
  const intentBlock = focus
    ? focus
    : '（用户未附带文字 — 请按开放式描述处理：按区域写清主要场景/界面与关键可见文字。）';

  const multi =
    imageCount > 1
      ? [
          '',
          `本次共 ${imageCount} 张图，按顺序编号为【图1】…【图${imageCount}】。`,
          '必须对每张图分别输出一段，格式固定为：',
          '【图1】',
          '（该图内容）',
          '【图2】',
          '（该图内容）',
          '不要把多张图混成一段；不要跳过任何一张。',
        ]
      : [];

  return [
    '你是图像理解助手。下游是文本模型，看不到像素，只能靠你的转写作答。',
    '',
    '输出要求：',
    '- 纯文本；可用简短编号分点，不要长篇开场白，不要复述用户原话。',
    '- 信息要够用：开放式问题（如「有什么」「描述一下」）按区域写清主要 UI/场景、关键可见文字与布局关系；具体问题（读字、读数、找某物）紧扣问题，可更详细。',
    '- 列表页（归档、目录、搜索结果、表格行等）：可见条目尽量列全（标题/编号/日期等），不要用「等」省略。',
    '- 截图套截图：若图中还嵌套另一张图、弹窗或气泡里的描述文字，先写当前页 UI，再单独注明「图中嵌套内容为…」，避免与当前页混为一谈。',
    '- 可见文字尽量原样转录；看不清就写「模糊/不可辨」。',
    '- 不要臆造图中没有的内容；不要评论「这是截图」「用户在问什么」。',
    ...multi,
    '',
    '用户消息（看图时以此为意图）：',
    intentBlock,
  ].join('\n');
}

const OCR_RETRY_SYSTEM = [
  '你是图像 OCR 助手。只输出图片中可见文字的纯文本转录，保持原有换行。',
  '若无文字，用一两句话概括图片。不要 Markdown，不要解释。',
  '若有多张图，按【图1】【图2】…分段输出。',
].join('\n');

function batchTimeoutMs(imageCount: number): number {
  return Math.min(
    UNDERSTAND_TIMEOUT_MS + Math.max(0, imageCount - 1) * 15_000,
    BATCH_TIMEOUT_CAP_MS,
  );
}

async function callVision(
  client: OpenAI,
  imageParts: Record<string, unknown>[],
  system: string,
  timeoutMs: number,
): Promise<string> {
  const n = imageParts.length;
  const lead =
    n === 1
      ? '请根据系统说明观察这张图片。'
      : `请根据系统说明依次观察这 ${n} 张图片，并按【图1】…【图${n}】分段输出。`;

  const res = await withTimeout(
    client.chat.completions.create({
      model: IMAGE_UNDERSTAND_MODEL,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [{ type: 'text', text: lead }, ...imageParts] as any,
        },
      ],
    }),
    timeoutMs,
  );
  return String(res.choices?.[0]?.message?.content || '').trim();
}

/**
 * Split a batch transcription into per-image texts when the model used 【图N】 markers.
 * Falls back to repeating the full text if markers are missing.
 */
export function splitBatchImageTexts(
  text: string,
  imageCount: number,
): string[] {
  if (imageCount <= 1) return [text];
  const re = /【图\s*(\d+)\s*】/g;
  const matches: Array<{ n: number; markerEnd: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    matches.push({ n: Number(m[1]), markerEnd: m.index + m[0].length });
  }
  if (matches.length < 2) {
    return Array.from({ length: imageCount }, () => text);
  }
  const byIndex: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const nextStart =
      i + 1 < matches.length
        ? text.indexOf('【图', matches[i].markerEnd)
        : -1;
    const sliceEnd = nextStart >= 0 ? nextStart : text.length;
    byIndex[matches[i].n - 1] = text.slice(matches[i].markerEnd, sliceEnd).trim();
  }
  return Array.from({ length: imageCount }, (_, i) => byIndex[i]?.trim() || text);
}

/**
 * Call GLM-4.6V with system prompt + one or more images.
 */
export async function understandImages(
  imageUrls: string[],
  userPrompt: string,
  gateway: { apiKey: string; baseURL: string },
): Promise<ImageUnderstandResult & { texts: string[] }> {
  const urls = imageUrls.map((u) => String(u || '').trim()).filter(Boolean);
  if (urls.length === 0) {
    return {
      ok: false,
      text: 'Invalid image URL.',
      mode: 'error',
      texts: [],
    };
  }

  const imageParts: Record<string, unknown>[] = [];
  for (const url of urls) {
    const part = toVisionImagePart(url);
    if (!part) {
      return {
        ok: false,
        text: 'Invalid image URL.',
        mode: 'error',
        texts: urls.map(() => 'Invalid image URL.'),
      };
    }
    imageParts.push(part);
  }

  const client = new OpenAI({
    apiKey: gateway.apiKey,
    baseURL: gateway.baseURL,
  });

  const system = buildImageUnderstandSystemPrompt(userPrompt, urls.length);
  const timeoutMs = batchTimeoutMs(urls.length);

  try {
    const text = await callVision(client, imageParts, system, timeoutMs);
    if (text) {
      const texts = splitBatchImageTexts(text, urls.length);
      return { ok: true, text, texts, mode: 'understand' };
    }
  } catch (err) {
    console.warn('image-understand: vision call failed, trying OCR fallback', err);
  }

  try {
    const text = await callVision(client, imageParts, OCR_RETRY_SYSTEM, timeoutMs);
    if (text) {
      const texts = splitBatchImageTexts(text, urls.length);
      return { ok: true, text, texts, mode: 'ocr' };
    }
  } catch (err) {
    console.warn('image-understand: OCR fallback also failed', err);
  }

  // Batch failed — fall back to one-by-one so partial success is still useful.
  if (urls.length > 1) {
    const texts: string[] = [];
    let anyOk = false;
    for (const url of urls) {
      const one = await understandImage({ imageUrl: url, userPrompt }, gateway);
      texts.push(one.text);
      if (one.ok) anyOk = true;
    }
    return {
      ok: anyOk,
      text: texts.map((t, i) => `【图${i + 1}】\n${t}`).join('\n\n'),
      texts,
      mode: anyOk ? 'understand' : 'error',
    };
  }

  return {
    ok: false,
    text: 'Failed to understand the image. Please try a vision-capable model for best results.',
    mode: 'error',
    texts: [
      'Failed to understand the image. Please try a vision-capable model for best results.',
    ],
  };
}

/**
 * Call GLM-4.6V with system prompt + user image. Output is plain text for the chat model.
 */
export async function understandImage(
  input: ImageUnderstandInput,
  gateway: { apiKey: string; baseURL: string },
): Promise<ImageUnderstandResult> {
  const result = await understandImages(
    [input.imageUrl],
    input.userPrompt || input.instruction || '',
    gateway,
  );
  return { ok: result.ok, text: result.text, mode: result.mode };
}

function textPartsFromMessageContent(parts: any[]): string {
  return parts
    .filter((p) => p && p.type === 'text')
    .map((p) => String(p.text || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

function formatInjectionText(description: string, imageCount = 1): string {
  const head =
    imageCount > 1
      ? `以下是 ${imageCount} 张图片的内容（由视觉模型转写，请当作你已看到这些图，直接据此回答用户；不要解释这段转写本身）：`
      : '以下是图片内容（由视觉模型转写，请当作你已看到该图，直接据此回答用户；不要解释这段转写本身）：';
  return `${head}\n${description}`;
}

/**
 * Replace image_url parts with plain-text descriptions from GLM-4.6V.
 * Images in the same message are understood in one batched vision call.
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

    const imageSlots: Array<{ partIndex: number; url: string; label: string }> = [];
    for (let i = 0; i < msg.content.length; i++) {
      const part = msg.content[i];
      if (!part || part.type !== 'image_url') continue;
      const url = String(part?.image_url?.url || part?.url || '').trim();
      if (!url) continue;
      imageIndex += 1;
      imageSlots.push({ partIndex: i, url, label: `Image ${imageIndex}` });
    }

    if (imageSlots.length === 0) {
      out.push(msg);
      continue;
    }

    const query = turnPrompt
      ? turnPrompt.slice(0, 120)
      : `${imageSlots.length} image(s)`;

    opts?.send?.({
      tool: {
        status: 'start',
        name: 'image_understand',
        query,
        provider: 'zhipu-vision',
      },
    });

    const batch = await understandImages(
      imageSlots.map((s) => s.url),
      turnPrompt,
      gateway,
    );

    opts?.send?.({
      tool: {
        status: 'done',
        name: 'image_understand',
        query,
        provider: 'zhipu-vision',
        results: batch.ok
          ? imageSlots.map((slot, i) => ({
              title: slot.label,
              url: '',
              snippet: batch.texts[i] || batch.text,
            }))
          : [],
        error: batch.ok ? undefined : batch.text,
      },
    });

    const descByPartIndex = new Map<number, true>();
    imageSlots.forEach((slot) => {
      descByPartIndex.set(slot.partIndex, true);
    });

    const imageTexts = imageSlots.map((_, i) => {
      const body = batch.texts[i] || batch.text;
      return batch.ok
        ? imageSlots.length > 1
          ? `【图${i + 1}】\n${body}`
          : body
        : `[Image understanding failed] ${body}`;
    });
    const injection = formatInjectionText(
      imageTexts.join('\n\n'),
      imageSlots.length,
    );

    // Keep non-image text parts; replace image slots with one combined injection.
    const rebuilt: any[] = [];
    let injected = false;
    for (let i = 0; i < msg.content.length; i++) {
      if (descByPartIndex.has(i)) {
        if (!injected) {
          rebuilt.push({ type: 'text', text: injection });
          injected = true;
        }
        continue;
      }
      rebuilt.push(msg.content[i]);
    }

    const collapsed: any[] = [];
    for (const p of rebuilt) {
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
