/**
 * Image → text preprocessor for text-only chat models.
 *
 * Fallback order (correct product logic):
 *   1) Understand stage — VLMs that describe scene/UI/intent (glm-4.6v, optional nano-omni)
 *   2) OCR stage — text-extraction only (glm-ocr layout_parsing, then VLM OCR prompt as last resort)
 *
 * Never start with OCR-only backends; those cannot answer “what is happening in this screenshot”.
 */

import OpenAI from 'openai';
import { filesGatewayBaseURL, toImageContentPart } from '@/lib/files/gateway';
import { zhipuApiKey } from '@/lib/tools/zhipu/credentials';

export const IMAGE_UNDERSTAND_MODEL = 'glm-4.6v';
/** Optional second understand backend on the CPA gateway (multimodal). */
export const IMAGE_UNDERSTAND_FALLBACK_MODEL = 'nemotron-3-nano-omni-free';
export const IMAGE_OCR_MODEL = 'glm-ocr';
const UNDERSTAND_TIMEOUT_MS = 45_000;
const BATCH_TIMEOUT_CAP_MS = 90_000;
const OCR_TIMEOUT_MS = 60_000;
const ZHIPU_LAYOUT_PARSING_URL =
  'https://open.bigmodel.cn/api/paas/v4/layout_parsing';
const ZHIPU_CHAT_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

/** PaaS REST (layout_parsing / chat) — prefer non-Coding keys. */
function zhipuPaasApiKey(): string | undefined {
  return (
    process.env.ZHIPU_API_KEY?.trim() ||
    process.env.ZHIPUAI_API_KEY?.trim() ||
    process.env.BIGMODEL_API_KEY?.trim() ||
    process.env.ZHIPU_CODING_API_KEY?.trim() ||
    zhipuApiKey()
  );
}

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
  /** Which backend produced the text (for Process / debugging). */
  provider?: string;
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

function bytesToBase64(buf: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Bare portal/new-api file id, or `/api/files/<id>` path. */
function gatewayFileIdFromRef(imageUrl: string): string {
  const raw = String(imageUrl || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/api/files/')) {
    return decodeURIComponent(
      raw.slice('/api/files/'.length).split(/[?#]/)[0] || '',
    );
  }
  // https / data / absolute paths are not gateway ids
  if (/^(https?:\/\/|data:)/i.test(raw) || raw.includes('/')) return '';
  return raw;
}

/**
 * Portal Files ids are not resolvable by upstream VLMs as bare `image_url`
 * strings (new-api no longer owns /v1/files). Fetch bytes and inline as a
 * data URL so glm-4.6v / OCR backends can actually see the pixels.
 */
export async function resolveImageUrlForVision(
  imageUrl: string,
  gateway: { apiKey: string; baseURL: string },
): Promise<string> {
  const raw = String(imageUrl || '').trim();
  if (!raw) throw new Error('Empty image URL');
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;

  const fileId = gatewayFileIdFromRef(raw);
  if (!fileId) throw new Error('Invalid image reference');

  // Files live on chat-api; LLM gateway baseURL is not used for /files content.
  const base = filesGatewayBaseURL();
  const res = await fetch(`${base}/files/${encodeURIComponent(fileId)}/content`, {
    headers: { Authorization: `Bearer ${gateway.apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Gateway file fetch failed: HTTP ${res.status}`);
  }
  const mime = (res.headers.get('content-type') || 'image/png').split(';')[0].trim();
  const buf = new Uint8Array(await res.arrayBuffer());
  return `data:${mime || 'image/png'};base64,${bytesToBase64(buf)}`;
}

function toVisionImagePart(imageUrl: string): Record<string, unknown> | null {
  const raw = String(imageUrl || '').trim();
  if (!raw) return null;
  // Prefer real URLs / data URIs. Bare file ids only as a last resort (legacy).
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

function visionMessageText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const m = message as Record<string, unknown>;
  const content = m.content;
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        const p = part as Record<string, unknown>;
        return String(p.text || p.content || '').trim();
      })
      .filter(Boolean)
      .join('\n')
      .trim();
    if (joined) return joined;
  }
  // GLM vision often puts the whole answer in reasoning_content when thinking
  // runs, leaving content empty — still usable as an image transcription.
  for (const key of ['reasoning_content', 'reasoning', 'thinking_content', 'thinking']) {
    const v = m[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

async function callVision(
  client: OpenAI,
  model: string,
  imageParts: Record<string, unknown>[],
  system: string,
  timeoutMs: number,
): Promise<string> {
  const n = imageParts.length;
  const lead =
    n === 1
      ? '请根据系统说明观察这张图片。'
      : `请根据系统说明依次观察这 ${n} 张图片，并按【图1】…【图${n}】分段输出。`;

  const create = (extra: Record<string, unknown> = {}) =>
    withTimeout(
      client.chat.completions.create({
        model,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [{ type: 'text', text: lead }, ...imageParts] as any,
          },
        ],
        ...extra,
      } as any),
      timeoutMs,
    );

  // Prefer no thinking: Image Understand needs a plain transcription, and some
  // GLM vision routes put the entire answer in reasoning_content otherwise.
  let res: any;
  try {
    res = await create({ enable_thinking: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/enable_thinking/i.test(msg)) {
      res = await create();
    } else {
      throw err;
    }
  }
  return visionMessageText(res?.choices?.[0]?.message);
}

/** Resolve image ref to a URL or raw base64 string for Zhipu layout_parsing. */
async function resolveFileForLayoutParsing(
  imageUrl: string,
  gateway: { apiKey: string; baseURL: string },
): Promise<string> {
  const raw = String(imageUrl || '').trim();
  if (!raw) throw new Error('Empty image URL');
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('data:')) {
    const m = raw.match(/^data:[^;]+;base64,(.+)$/i);
    if (!m?.[1]) throw new Error('Invalid data URL for OCR');
    return m[1];
  }

  const dataUrl = await resolveImageUrlForVision(raw, gateway);
  const m = dataUrl.match(/^data:[^;]+;base64,(.+)$/i);
  if (!m?.[1]) throw new Error('Invalid data URL for OCR');
  return m[1];
}

function layoutParsingText(data: Record<string, unknown>): string {
  const md = String(data.md_results || '').trim();
  if (md) return md;

  const details = data.layout_details;
  if (!Array.isArray(details)) return '';
  const lines: string[] = [];
  for (const page of details) {
    if (!Array.isArray(page)) continue;
    for (const el of page) {
      if (!el || typeof el !== 'object') continue;
      const row = el as { label?: string; content?: string };
      const content = String(row.content || '').trim();
      if (!content) continue;
      if (row.label === 'image') continue;
      lines.push(content);
    }
  }
  return lines.join('\n').trim();
}

/** Dedicated OCR via Zhipu GLM-OCR (layout_parsing). Text extraction only. */
async function callGlmOcr(
  imageUrl: string,
  gateway: { apiKey: string; baseURL: string },
): Promise<string> {
  const key = zhipuPaasApiKey();
  if (!key) throw new Error('ZHIPU_API_KEY missing for glm-ocr');

  const file = await resolveFileForLayoutParsing(imageUrl, gateway);
  const res = await withTimeout(
    fetch(ZHIPU_LAYOUT_PARSING_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: IMAGE_OCR_MODEL, file }),
    }),
    OCR_TIMEOUT_MS,
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = data.error as { message?: string } | undefined;
    throw new Error(
      err?.message ||
        String(data.message || data.msg || `glm-ocr HTTP ${res.status}`),
    );
  }
  const text = layoutParsingText(data);
  if (!text) throw new Error('glm-ocr returned empty text');
  return text;
}

type UnderstandBackend = {
  id: string;
  model: string;
};

/** Stage 1: scene/UI understanding (not OCR-only). */
function understandBackends(): UnderstandBackend[] {
  return [
    { id: 'zhipu-vision', model: IMAGE_UNDERSTAND_MODEL },
    // Second VLM on the same gateway when the primary understand call fails.
    { id: 'nemotron-omni', model: IMAGE_UNDERSTAND_FALLBACK_MODEL },
  ];
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
 * Call vision backends: portal-local first (avoids CF large-body blocks), then
 * gateway VLMs, then OCR.
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

  const errors: string[] = [];

  // —— Stage 0: portal-local understand (file ids only) ——
  // Vercel must not POST multi-MB data URLs back through Cloudflare at
  // api.llm.christmas — CF 1010 blocks them, and every gateway VLM fails together.
  // Portal reads the file from disk and calls new-api on localhost.
  const portalFileIds = urls.map(gatewayFileIdFromRef);
  if (portalFileIds.every(Boolean)) {
    try {
      const texts: string[] = [];
      let provider = 'portal-vision';
      for (let i = 0; i < portalFileIds.length; i++) {
        const one = await callPortalVisionUnderstand(
          portalFileIds[i],
          userPrompt,
          gateway,
        );
        texts.push(one.text);
        provider = one.provider || provider;
      }
      const text =
        texts.length > 1
          ? texts.map((t, i) => `【图${i + 1}】\n${t}`).join('\n\n')
          : texts[0] || '';
      if (text.trim()) {
        return {
          ok: true,
          text,
          texts,
          mode: 'understand',
          provider,
        };
      }
      errors.push('portal-vision: empty');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`portal-vision: ${message}`);
      console.warn(
        '[image-understand] portal vision failed, trying gateway backends:',
        message,
      );
    }
  }

  // Expand portal file ids → data URLs before calling upstream VLMs.
  const resolvedUrls: string[] = [];
  try {
    for (const url of urls) {
      resolvedUrls.push(await resolveImageUrlForVision(url, gateway));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[image-understand] resolve image for vision failed:', message);
    // If portal already failed and we cannot inline, surface both.
    if (errors.length) {
      const detail = [...errors, `resolve: ${message}`].join(' · ').slice(0, 400);
      return {
        ok: false,
        text: `Failed to understand the image (${detail}).`,
        mode: 'error',
        texts: urls.map(() => `Failed to understand the image (${detail}).`),
      };
    }
    return {
      ok: false,
      text: `Failed to load image for understanding (${message}).`,
      mode: 'error',
      texts: urls.map(() => `Failed to load image for understanding (${message}).`),
    };
  }

  const imageParts: Record<string, unknown>[] = [];
  for (const url of resolvedUrls) {
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
    defaultHeaders: {
      // Cloudflare bot fight on api.llm.christmas rejects large POSTs without a UA.
      'User-Agent': 'ChristmasChat-ImageUnderstand/1.0',
    },
  });

  const system = buildImageUnderstandSystemPrompt(userPrompt, urls.length);
  const timeoutMs = batchTimeoutMs(urls.length);

  // —— Stage 1: understand via gateway VLMs ——
  for (const backend of understandBackends()) {
    try {
      const text = await callVision(
        client,
        backend.model,
        imageParts,
        system,
        timeoutMs,
      );
      if (text) {
        const texts = splitBatchImageTexts(text, urls.length);
        return {
          ok: true,
          text,
          texts,
          mode: 'understand',
          provider: backend.id,
        };
      }
      errors.push(`${backend.id}: empty`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${backend.id}: ${message}`);
      console.warn(
        `[image-understand] understand backend ${backend.id} failed, trying next:`,
        message,
      );
    }
  }

  // —— Stage 1b: Zhipu PaaS direct (bypasses api.llm.christmas / CF) ——
  const paasKey = zhipuPaasApiKey();
  if (paasKey) {
    try {
      const text = await callZhipuPaasVision(
        paasKey,
        resolvedUrls,
        system,
        timeoutMs,
      );
      if (text) {
        const texts = splitBatchImageTexts(text, urls.length);
        return {
          ok: true,
          text,
          texts,
          mode: 'understand',
          provider: 'zhipu-paas-vision',
        };
      }
      errors.push('zhipu-paas-vision: empty');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`zhipu-paas-vision: ${message}`);
      console.warn('[image-understand] zhipu paas vision failed:', message);
    }
  }

  // —— Stage 2: OCR-only (after understand exhausted) ——
  if (zhipuPaasApiKey()) {
    try {
      const texts: string[] = [];
      for (const url of urls) {
        texts.push(await callGlmOcr(url, gateway));
      }
      const text =
        texts.length > 1
          ? texts.map((t, i) => `【图${i + 1}】\n${t}`).join('\n\n')
          : texts[0] || '';
      if (text.trim()) {
        return {
          ok: true,
          text,
          texts,
          mode: 'ocr',
          provider: 'glm-ocr',
        };
      }
      errors.push('glm-ocr: empty');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`glm-ocr: ${message}`);
      console.warn(
        '[image-understand] glm-ocr failed, trying VLM OCR prompt:',
        message,
      );
    }
  }

  // 2b) Last resort: same VLM with OCR-only system prompt (still after understand).
  try {
    const text = await callVision(
      client,
      IMAGE_UNDERSTAND_MODEL,
      imageParts,
      OCR_RETRY_SYSTEM,
      timeoutMs,
    );
    if (text) {
      const texts = splitBatchImageTexts(text, urls.length);
      return {
        ok: true,
        text,
        texts,
        mode: 'ocr',
        provider: 'zhipu-vision-ocr-prompt',
      };
    }
    errors.push('zhipu-vision-ocr-prompt: empty');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`zhipu-vision-ocr-prompt: ${message}`);
    console.warn('[image-understand] OCR prompt fallback also failed', message);
  }

  // Batch failed — fall back to one-by-one so partial success is still useful.
  if (urls.length > 1) {
    const texts: string[] = [];
    let anyOk = false;
    let mode: ImageUnderstandResult['mode'] = 'error';
    let provider: string | undefined;
    for (const url of urls) {
      const one = await understandImage({ imageUrl: url, userPrompt }, gateway);
      texts.push(one.text);
      if (one.ok) {
        anyOk = true;
        mode = one.mode;
        provider = one.provider || provider;
      }
    }
    return {
      ok: anyOk,
      text: texts.map((t, i) => `【图${i + 1}】\n${t}`).join('\n\n'),
      texts,
      mode: anyOk ? mode : 'error',
      provider,
    };
  }

  console.warn('[image-understand] all backends failed:', errors.join(' | '));
  const detail = errors.slice(0, 4).join(' · ').slice(0, 400);
  return {
    ok: false,
    text: detail
      ? `Failed to understand the image (${detail}). Please try a vision-capable model for best results.`
      : 'Failed to understand the image. Please try a vision-capable model for best results.',
    mode: 'error',
    texts: [
      detail
        ? `Failed to understand the image (${detail}). Please try a vision-capable model for best results.`
        : 'Failed to understand the image. Please try a vision-capable model for best results.',
    ],
  };
}

async function callPortalVisionUnderstand(
  fileId: string,
  userPrompt: string,
  gateway: { apiKey: string; baseURL: string },
): Promise<{ text: string; provider?: string }> {
  const base = gateway.baseURL.replace(/\/$/, '');
  const res = await withTimeout(
    fetch(`${base}/vision/understand`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gateway.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'ChristmasChat-ImageUnderstand/1.0',
      },
      body: JSON.stringify({
        file_id: fileId,
        prompt: userPrompt,
        model: IMAGE_UNDERSTAND_MODEL,
      }),
    }),
    BATCH_TIMEOUT_CAP_MS,
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.ok === false) {
    const err = data.error as { message?: string } | undefined;
    throw new Error(
      err?.message ||
        String(data.text || data.message || `portal vision HTTP ${res.status}`),
    );
  }
  const text = String(data.text || '').trim();
  if (!text) throw new Error('portal vision returned empty text');
  return {
    text,
    provider: String(data.provider || 'portal-vision'),
  };
}

async function callZhipuPaasVision(
  apiKey: string,
  dataUrls: string[],
  system: string,
  timeoutMs: number,
): Promise<string> {
  const n = dataUrls.length;
  const lead =
    n === 1
      ? '请根据系统说明观察这张图片。'
      : `请根据系统说明依次观察这 ${n} 张图片，并按【图1】…【图${n}】分段输出。`;
  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: lead },
    ...dataUrls.map((url) => ({
      type: 'image_url',
      image_url: { url },
    })),
  ];
  const res = await withTimeout(
    fetch(ZHIPU_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: IMAGE_UNDERSTAND_MODEL,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content },
        ],
      }),
    }),
    timeoutMs,
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = data.error as { message?: string } | undefined;
    throw new Error(
      err?.message ||
        String(data.message || data.msg || `zhipu paas HTTP ${res.status}`),
    );
  }
  const choices = data.choices as Array<{ message?: unknown }> | undefined;
  return visionMessageText(choices?.[0]?.message);
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
  return { ok: result.ok, text: result.text, mode: result.mode, provider: result.provider };
}
