import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import { fetchFreeModelNames, looksFreeByName } from '@/lib/pricing';
import {
  CURSOR_WEB_CHAT_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  activeIntegrationsPrompt,
  conversationIsolationPrompt,
  getModelSpec,
  isCursorStyleModel,
} from '@/lib/model-specs';
import type { SearchOutcome } from '@/lib/web-search';
import {
  createStampLeakStripper,
  stampMessageText,
  stripMessageStamp,
  timeContextSystemPrompt,
  freshnessForQuery,
  enrichSearchQuery,
  englishRecencyQuery,
  getClockContext,
} from '@/lib/time-context';
import {
  executeRegisteredTool,
  formatWebSearchToolContent,
  openaiToolDefinitions,
  resolveEnabledToolsAsync,
  runWebSearch,
  toolSystemPrompt,
  type ToolRuntimeContext,
} from '@/lib/tools';
import { hasPersistedImageTranscription, imageRefsFromMessageImages, mergePersistedImageRefs, parseImageArchiveRefs, rewriteMessagesWithImageDescriptions, stripImageArchiveBlock, stripPersistedImageTranscription } from '@/lib/image-understand';
import { streamCompletionPayload } from '@/lib/truncation';
import {
  getNotionMcpAccessToken,
  getGitHubAccessToken,
  getGoogleAccessToken,
  resolveOwnerId,
  upsertNotionConnection,
  upsertGoogleConnection,
  wantsGoogleToken,
  normalizeGoogleIntegrations,
  enabledGoogleServices,
} from '@/lib/integrations';
import {
  gatewayBaseURL as filesBaseURL,
  generatedImageAssistantSummary,
  toImageContentPart,
  uploadGatewayDataUrl,
} from '@/lib/gateway-files';
import {
  detectFakedToolNarration,
  buildCorrectionPrompt,
  emitReviewerStep,
  REVIEWER_SYSTEM_PROMPT,
} from '@/lib/claim-reviewer';
import { isSkillCreatorId } from '@/lib/skill-creator';

export const runtime = 'edge';
export const maxDuration = 300;

const MAX_TOOL_ROUNDS = 3;
/** Model may think for a long time before emitting tool_calls; keep this generous. */
const TOOLS_ROUND_TIMEOUT_MS = 90_000;
const FINAL_STREAM_TIMEOUT_MS = 90_000;

function jsonError(message: string, status: number = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Whether to send `enable_thinking: true` proactively.
 *
 * Keep this narrow: llm.christmas validates the parameter per model and returns
 * 400 Unsupported for variants that do not allow it (seen on deepseek-v4-flash).
 * Name tokens like r1 / reason / thinking / qwq are the safe opt-in signal.
 * Do NOT blanket whole families (deepseek-v4*, glm-5*, kimi-k2*, minimax-m3*) —
 * streamChatCompletionsRaw also retries once without the flag if rejected.
 *
 * Separately, modelNeedsThinkingForTools() may still force thinking for GLM
 * when tools are present (empty-stream workaround).
 */
function wantsThinking(model: string) {
  return /(^|[-_])(r1|reason|thinking|qwq)([-_]|$)/i.test(String(model || ''));
}

/** GLM-4.7 tool-calling expects thinking; without it the stream often ends empty. */
function modelNeedsThinkingForTools(model: string) {
  return /glm-4\.7|glm-4\.6(?!v)|glm-5/i.test(String(model || ''));
}

/**
 * These models often put the full answer in reasoning_* even when the user-
 * visible reply should be normal chat text. The server still sends reasoning
 * and content separately; the **client** promotes orphan reasoning → content
 * at settle time if the stream produced no visible content.
 */
function modelDumpsAnswerInReasoning(model: string) {
  return /glm-4\.7|glm-4\.6(?!v)/i.test(String(model || ''));
}

/**
 * Raw SSE chat.completions — preserves gateway-only fields like reasoning_content
 * that the OpenAI SDK types omit (runtime usually keeps them, but this is explicit).
 * If the gateway rejects enable_thinking, retry once without it.
 */
async function* streamChatCompletionsRaw(opts: {
  apiKey: string;
  baseURL: string;
  body: Record<string, unknown>;
}): AsyncGenerator<any> {
  const post = async (body: Record<string, unknown>) =>
    fetch(`${opts.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ ...body, stream: true }),
    });

  let body: Record<string, unknown> = { ...opts.body };
  let res = await post(body);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const unsupportedThinking =
      Boolean(body.enable_thinking) &&
      res.status === 400 &&
      /enable_thinking/i.test(errText);
    if (unsupportedThinking) {
      const { enable_thinking: _drop, ...rest } = body;
      body = rest;
      console.warn(
        'upstream rejected enable_thinking; retrying without it',
        body.model,
      );
      res = await post(body);
    }
    if (!res.ok) {
      const retryText = unsupportedThinking
        ? await res.text().catch(() => errText)
        : errText;
      throw new Error(
        `Upstream chat error: ${res.status} ${
          (retryText || res.statusText).slice(0, 300)
        }`,
      );
    }
  }
  if (!res.body) throw new Error('Upstream chat returned an empty body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        yield JSON.parse(data);
      } catch {
        // ignore malformed SSE lines
      }
    }
  }
}

/**
 * Split a chat-completions delta into visible answer vs chain-of-thought.
 * Some gateways (notably GLM-4.7) put the whole reply in reasoning_* even when
 * we did not request thinking — treat those as content in that case.
 */
function splitCompletionDelta(
  delta: any,
  opts: { reasoningAsContent: boolean },
): { content: string; reasoning: string } {
  let content = '';
  let reasoning = '';

  const rawContent = delta?.content;
  if (typeof rawContent === 'string') {
    content += rawContent;
  } else if (Array.isArray(rawContent)) {
    for (const part of rawContent) {
      const type = String(part?.type || '');
      const text = String(
        part?.text || part?.content || part?.thinking || part?.reasoning || '',
      );
      if (!text) continue;
      if (type === 'thinking' || type === 'reasoning') reasoning += text;
      else content += text;
    }
  }

  reasoning +=
    String(delta?.reasoning_content || '') +
    String(delta?.reasoning || '') +
    String(delta?.thinking || '') +
    String(delta?.thinking_content || '');

  if (opts.reasoningAsContent && reasoning) {
    content += reasoning;
    reasoning = '';
  }
  return { content, reasoning };
}

/** Heuristic: user clearly wants a live lookup (used for cursor-* proactive search). */
function looksLikeSearchRequest(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  return /查一下|帮我查|搜一下|搜索|查找|找一下|最近.*项目|最新|新闻|行情|融资|目前|现在怎么样|现在怎样|如何了|价格|价位|走势|涨跌|多少钱|price|search|look\s*up|find\s+(me\s+)?(the\s+)?(latest|recent)|what.*(happening|new)|how\s+is\s+|google/i.test(
    t,
  );
}

/** Cursor often narrates “I'll search…” instead of emitting tool_calls. */
function narratesSearchInsteadOfCalling(text: string): boolean {
  return /先.{0,10}(查|搜)|正在(查|搜|联网)|让我(去)?(查|搜)|我来(查|搜)|I'll (go )?(and )?(search|look\s*up)|let me (search|look\s*up)|searching (the )?(web|internet)/i.test(
    String(text || ''),
  );
}

function extractToolCalls(message: any): Array<{
  id: string;
  name: string;
  arguments: string;
}> {
  const raw = message?.tool_calls;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((tc: any, i: number) => ({
      id: String(tc?.id || `call_${i}`),
      name: String(tc?.function?.name || tc?.name || ''),
      arguments: String(tc?.function?.arguments || tc?.arguments || '{}'),
    }))
    .filter((tc) => tc.name);
}

function lastUserText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    if (typeof m.content === 'string') return stripMessageStamp(m.content);
    if (Array.isArray(m.content)) {
      return stripMessageStamp(
        m.content
          .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
          .filter(Boolean)
          .join('\n'),
      );
    }
  }
  return '';
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Stamp user turns only; scrub any leaked stamps from assistant history. */
function withMessageTimestamps(messages: any[]): any[] {
  return messages.map((m) => {
    const ts = parseTimestampMs(m.timestamp);

    const mapText = (text: string) => {
      // Never stamp assistant/tool turns — that teaches the model to echo `[2026-…]`.
      if (m?.role === 'user') return stampMessageText(text, ts);
      if (m?.role === 'assistant') return stripMessageStamp(text);
      return text;
    };

    if (typeof m.content === 'string') {
      return { ...m, content: mapText(m.content) };
    }
    if (Array.isArray(m.content)) {
      let touched = false;
      const content = m.content.map((part: any) => {
        if (touched || part?.type !== 'text' || typeof part.text !== 'string') return part;
        touched = true;
        return { ...part, text: mapText(part.text) };
      });
      return { ...m, content };
    }
    return m;
  });
}

/**
 * OpenAI-compatible gateways (incl. some GLM routes) reject unknown message
 * fields like `timestamp` / `images`. Keep only chat-completion schema keys.
 */
function lastUserMessageHasImageParts(messages: any[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    if (!Array.isArray(m?.content)) return false;
    return m.content.some((p: any) => p?.type === 'image_url');
  }
  return false;
}

function sanitizeChatMessages(messages: any[]): any[] {
  return messages.map((m) => {
    const role = m?.role;
    const out: Record<string, unknown> = { role };
    if (m?.content !== undefined) out.content = m.content;
    if (Array.isArray(m?.tool_calls) && m.tool_calls.length > 0) {
      out.tool_calls = m.tool_calls;
    }
    if (m?.tool_call_id != null) out.tool_call_id = m.tool_call_id;
    if (typeof m?.name === 'string' && m.name) out.name = m.name;
    return out;
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  try {
    const {
      messages,
      model = 'deepseek-v4-flash-200k',
      temperature = 0.7,
      systemPrompt = '',
      referenceText = '',
      skills = [],
      conversationId = '',
      enableSearch = true,
      integrations = [],
      /** Tool layer: claim reviewer. */
      autoReview = true,
      requestReview = false,
    } = await req.json();
    const boundUserKey = req.cookies.get('llm_chat_api_key')?.value || '';
    const isBoundAccount = Boolean(boundUserKey);
    const requestedModel = String(model || '').trim();
    const threadId = String(conversationId || '').trim();
    const searchEnabled = enableSearch !== false;

    if (!isBoundAccount) {
      const freeModels = await fetchFreeModelNames();
      const isFree =
        freeModels.size > 0
          ? freeModels.has(requestedModel.toLowerCase())
          : looksFreeByName(requestedModel);

      if (!isFree) {
        return jsonError(
          'This model requires a connected llm.christmas account. Guests can only use free models.',
          403,
        );
      }
    }

    const apiKey = boundUserKey || process.env.LLM_CHRISTMAS_API_KEY || process.env.OPENAI_API_KEY || '';
    const baseURL = (process.env.LLM_CHRISTMAS_BASE_URL || 'https://api.llm.christmas/v1').replace(
      /\/$/,
      '',
    );

    if (!apiKey) {
      return jsonError('Missing LLM_CHRISTMAS_API_KEY in Vercel environment variables.', 500);
    }
    if (!Array.isArray(messages)) {
      return jsonError('Invalid request: messages must be an array.', 400);
    }

    const openai = new OpenAI({ apiKey, baseURL });
    const requestedIntegrations = normalizeGoogleIntegrations(
      Array.isArray(integrations)
        ? integrations.map((x: unknown) => String(x || '').trim().toLowerCase()).filter(Boolean)
        : [],
    );
    const skillCreatorOn = Array.isArray(skills)
      ? skills.some((s: any) => isSkillCreatorId(String(s?.id || '')))
      : false;
    // Intersect client toggles with vault OAuth — never trust integrations alone.
    const authorizedIntegrations: string[] = [];
    let notionAccessToken: string | undefined;
    let githubAccessToken: string | undefined;
    let googleAccessToken: string | undefined;
    let notionOwnerId: string | null = null;
    let googleOwnerId: string | null = null;
    let notionVaultUpdate: Awaited<
      ReturnType<typeof getNotionMcpAccessToken>
    >['updatedNotion'];
    let googleVaultUpdate: Awaited<
      ReturnType<typeof getGoogleAccessToken>
    >['updatedGoogle'];
    if (requestedIntegrations.includes('notion') && isBoundAccount) {
      notionOwnerId = await resolveOwnerId(req);
      if (notionOwnerId) {
        const mcp = await getNotionMcpAccessToken(req, notionOwnerId);
        if (mcp.token) {
          authorizedIntegrations.push('notion');
          notionAccessToken = mcp.token;
          notionVaultUpdate = mcp.updatedNotion;
        }
      }
    }
    if (requestedIntegrations.includes('github') && isBoundAccount) {
      const ownerId = notionOwnerId ?? (await resolveOwnerId(req));
      if (ownerId) {
        const token = await getGitHubAccessToken(req, ownerId);
        if (token) {
          authorizedIntegrations.push('github');
          githubAccessToken = token;
        }
      }
    }
    const requestedGoogleServices = enabledGoogleServices(requestedIntegrations);
    if (requestedGoogleServices.length > 0 && isBoundAccount) {
      const ownerId = notionOwnerId ?? (await resolveOwnerId(req));
      if (ownerId) {
        const mcp = await getGoogleAccessToken(req, ownerId);
        if (mcp.token) {
          authorizedIntegrations.push(...requestedGoogleServices);
          googleAccessToken = mcp.token;
          googleVaultUpdate = mcp.updatedGoogle;
          googleOwnerId = ownerId;
        }
      }
    }
    // Zhipu Vision MCP: no OAuth — just needs a logged-in CPA account (user key).
    if (requestedIntegrations.includes('zhipu-vision') && isBoundAccount && boundUserKey) {
      authorizedIntegrations.push('zhipu-vision');
    }
    const googleRequestedButUnauthorized =
      wantsGoogleToken(requestedIntegrations) &&
      !enabledGoogleServices(authorizedIntegrations).length;
    // Only tools for integrations the user enabled *and* authorized enter the
    // model context (definitions + system guidance). Off / unlinked ⇒ not included.
    let enabledTools = await resolveEnabledToolsAsync(
      {
        searchEnabled,
        integrations: skillCreatorOn
          ? [...authorizedIntegrations, 'skill-creator']
          : authorizedIntegrations,
      },
      { notionAccessToken, githubAccessToken, googleAccessToken },
    );
    // Vision chat models already see images natively — skip image_understand
    // to avoid double billing / conflicting tool calls.
    const modelIsVision = getModelSpec(requestedModel).vision;
    if (modelIsVision) {
      enabledTools = enabledTools.filter((t) => t.name !== 'image_understand');
    }
    let toolDefs = openaiToolDefinitions(enabledTools);
    const toolsGuidance = toolSystemPrompt(enabledTools);

    const systemParts: string[] = [];
    if (isCursorStyleModel(requestedModel)) {
      systemParts.push(CURSOR_WEB_CHAT_PROMPT);
    }
    systemParts.push(timeContextSystemPrompt());
    systemParts.push(String(systemPrompt || '').trim() || DEFAULT_SYSTEM_PROMPT);
    if (threadId) {
      systemParts.push(conversationIsolationPrompt(threadId));
    }
    systemParts.push(
      activeIntegrationsPrompt({
        searchEnabled,
        integrations: authorizedIntegrations,
        googleRequestedButUnauthorized,
      }),
    );
    if (toolsGuidance) {
      systemParts.push(toolsGuidance);
    }
    if (Array.isArray(skills)) {
      for (const skill of skills) {
        const title = String(skill?.title || 'Skill').trim();
        const content = String(skill?.content || '').trim();
        if (!content) continue;
        systemParts.push(`Active Skill — ${title}:\n${content}`);
      }
    }
    if (requestReview) {
      systemParts.push(
        'The user explicitly requested a claim review of your latest assistant answer. In your reply: verify each claim of tool success/search against the tool results in this conversation; if a claim lacks a real tool receipt, retract it and state the action was NOT performed. Otherwise confirm verification briefly.',
      );
    }
    if (autoReview || requestReview) {
      systemParts.push(REVIEWER_SYSTEM_PROMPT);
    }
    if (String(referenceText || '').trim()) {
      systemParts.push(
        `Reference material provided by the user. Treat it as authoritative context:\n\n${String(referenceText).trim()}`,
      );
    }

    const hasGeneratedImages = (messages as any[]).some(
      (m) => m?.role === 'assistant' && Array.isArray(m.images) && m.images.length > 0,
    );
    if (hasGeneratedImages) {
      systemParts.push(
        [
          'This chat already contains image(s) generated by Christmas Chat’s /image pipeline.',
          'They are shown in the UI and may be attached to later user turns for vision models.',
          'Never claim those images failed to generate, and never blame missing folders/workspaces.',
          'If the user asks about “这张图/刚才的图/生成的图”, refer to the generated image in this chat — do not web-search for substitutes unless asked.',
        ].join(' '),
      );
    }

    type ImageRef = { url?: string; fileId?: string; prompt?: string };

    const resolveImageRef = async (raw: any): Promise<ImageRef> => {
      if (typeof raw === 'string') return { url: raw };
      const url = raw?.url ? String(raw.url) : '';
      const fileId = raw?.fileId ? String(raw.fileId) : '';
      const prompt = raw?.prompt ? String(raw.prompt) : undefined;
      if (fileId) return { url, fileId, prompt };
      // Legacy local data URLs: upload once per request so follow-ups use file_id.
      if (url.startsWith('data:') && apiKey) {
        try {
          const uploaded = await uploadGatewayDataUrl({
            apiKey,
            baseURL: filesBaseURL(),
            dataUrl: url,
            filename: `chat-${Date.now()}.png`,
          });
          return {
            fileId: uploaded.id,
            url: `/api/files/${encodeURIComponent(uploaded.id)}`,
            prompt,
          };
        } catch {
          return { url, prompt };
        }
      }
      return { url, prompt };
    };

    const toVisionPart = (img: ImageRef) => toImageContentPart(img);

    const normalizedMessages: any[] = [];
    /** Generated pics can't ride on assistant turns — attach to the next user turn. */
    // Vision models: carry assistant-generated images onto the next user turn so
    // they can re-inspect them. Text-only models must NOT — otherwise Image
    // Understand (or a non-vision API) would treat /image outputs as new uploads.
    let pendingAssistantImages: ImageRef[] = [];
    const carryAssistantImages = modelIsVision;

    let lastUserMsgIdx = -1;
    for (let i = (messages as any[]).length - 1; i >= 0; i--) {
      if ((messages as any[])[i]?.role === 'user') {
        lastUserMsgIdx = i;
        break;
      }
    }
    /** `/api/files/<id>` or https path for a raw image ref; '' for data URLs. */
    const imageMarkerPath = (raw: any): string => {
      if (typeof raw === 'string') {
        return raw.startsWith('data:') ? '' : raw;
      }
      const fileId = raw?.fileId ? String(raw.fileId) : '';
      if (fileId) return `/api/files/${encodeURIComponent(fileId)}`;
      const url = raw?.url ? String(raw.url) : '';
      return url && !url.startsWith('data:') ? url : '';
    };

    for (let mi = 0; mi < (messages as any[]).length; mi++) {
      const m = (messages as any[])[mi];
      const role = m.role;
      const timestamp = m.timestamp;
      if (Array.isArray(m.content)) {
        if (carryAssistantImages && pendingAssistantImages.length && role === 'user') {
          const extra = pendingAssistantImages
            .map((img) => toVisionPart(img))
            .filter(Boolean);
          pendingAssistantImages = [];
          const content = Array.isArray(m.content)
            ? [...extra, ...m.content]
            : m.content;
          normalizedMessages.push({ role, content, timestamp });
        } else {
          if (role === 'user') pendingAssistantImages = [];
          normalizedMessages.push({ role, content: m.content, timestamp });
        }
        continue;
      }

      const text = typeof m.content === 'string' ? m.content : '';
      const rawImages: any[] = Array.isArray(m.images) ? m.images : [];

      // Text-only model + OLDER user turn with never-transcribed uploads:
      // keep lightweight reference markers instead of pixels. The model can
      // transcribe a specific one on demand via the image_understand tool.
      if (
        role === 'user' &&
        !modelIsVision &&
        mi !== lastUserMsgIdx &&
        rawImages.length > 0 &&
        !hasPersistedImageTranscription(text)
      ) {
        pendingAssistantImages = [];
        const refs = rawImages.map(imageMarkerPath).filter(Boolean);
        const marker = refs.length
          ? [
              '【历史图片引用（未转写）】',
              ...refs.map((p, i) => `- 图${i + 1}: ${p}`),
            ].join('\n')
          : '';
        const body = stripImageArchiveBlock(text).trim();
        normalizedMessages.push({
          role,
          timestamp,
          content: [body || (marker ? '' : '(image)'), marker]
            .filter(Boolean)
            .join('\n\n'),
        });
        continue;
      }

      const images: ImageRef[] = [];
      for (const raw of rawImages) {
        images.push(await resolveImageRef(raw));
      }

      if (role === 'user' && hasPersistedImageTranscription(text)) {
        const carried = carryAssistantImages ? pendingAssistantImages : [];
        pendingAssistantImages = [];
        const mergedRefs = mergePersistedImageRefs(
          imageRefsFromMessageImages(rawImages),
          parseImageArchiveRefs(text),
        );
        let resolvedUploads = images;
        if (mergedRefs.length > 0) {
          const fromRefs: ImageRef[] = [];
          for (const r of mergedRefs) {
            fromRefs.push(
              await resolveImageRef({
                fileId: r.fileId,
                url: r.fileId
                  ? `/api/files/${encodeURIComponent(r.fileId)}`
                  : r.url,
              }),
            );
          }
          resolvedUploads = fromRefs;
        }
        const visibleText =
          stripImageArchiveBlock(stripPersistedImageTranscription(text)).trim() ||
          (resolvedUploads.length || carried.length ? '(image)' : text);
        // Vision models should still receive the original pixels even after a
        // text-model turn persisted a transcription into content.
        if (modelIsVision && (resolvedUploads.length > 0 || carried.length > 0)) {
          const parts = [
            ...(carried.length
              ? [
                  {
                    type: 'text',
                    text: [
                      '【以下附带本对话中已成功生成的图片，供你直接查看】',
                      'The following image(s) were already generated successfully in this chat and are attached for you to inspect.',
                      'Acknowledge them as existing generations — do not say generation failed or search the web for replacements.',
                    ].join(' '),
                  },
                ]
              : []),
            ...(visibleText ? [{ type: 'text', text: visibleText }] : []),
            ...carried.map((img) => toVisionPart(img)).filter(Boolean),
            ...resolvedUploads.map((img) => toVisionPart(img)).filter(Boolean),
          ];
          normalizedMessages.push({ role, timestamp, content: parts });
        } else if (carried.length > 0) {
          const parts = [
            {
              type: 'text',
              text: [
                '【以下附带本对话中已成功生成的图片，供你直接查看】',
                'The following image(s) were already generated successfully in this chat and are attached for you to inspect.',
                'Acknowledge them as existing generations — do not say generation failed or search the web for replacements.',
              ].join(' '),
            },
            { type: 'text', text: stripImageArchiveBlock(text) },
            ...carried.map((img) => toVisionPart(img)).filter(Boolean),
          ];
          normalizedMessages.push({ role, timestamp, content: parts });
        } else {
          // Text models: keep transcription, drop the archive metadata block.
          normalizedMessages.push({
            role,
            content: stripImageArchiveBlock(text),
            timestamp,
          });
        }
        continue;
      }

      if (role === 'assistant') {
        // OpenAI-compatible assistants reject image_url parts (vision or not).
        if (images.length > 0) {
          if (carryAssistantImages) {
            pendingAssistantImages.push(...images);
          }
          const promptHint = images
            .map((img) => img.prompt)
            .filter((p): p is string => Boolean(p && String(p).trim()));
          const summary =
            text.trim() || generatedImageAssistantSummary(promptHint);
          normalizedMessages.push({ role, timestamp, content: summary });
        } else {
          // Empty string fails some gateways' ChatCompletionRequestAssistantMessageContent.
          normalizedMessages.push({
            role,
            content: text.length > 0 ? text : null,
            timestamp,
          });
        }
        continue;
      }

      const carried = carryAssistantImages ? pendingAssistantImages : [];
      pendingAssistantImages = [];
      const allImages = [...carried, ...images];
      if (allImages.length === 0) {
        normalizedMessages.push({ role, content: text, timestamp });
      } else {
        const parts = [
          ...(carried.length
            ? [
                {
                  type: 'text',
                  text: [
                    '【以下附带本对话中已成功生成的图片，供你直接查看】',
                    'The following image(s) were already generated successfully in this chat and are attached for you to inspect.',
                    'Acknowledge them as existing generations — do not say generation failed or search the web for replacements.',
                  ].join(' '),
                },
              ]
            : []),
          ...(text ? [{ type: 'text', text }] : []),
          ...allImages.map((img) => toVisionPart(img)).filter(Boolean),
        ];
        normalizedMessages.push({
          role,
          timestamp,
          content: parts,
        });
      }
    }

    // No following user turn yet — keep a text stub only (can't put images on assistant).
    pendingAssistantImages = [];


    const userAsk = lastUserText(normalizedMessages);
    const zhipuVisionOn = authorizedIntegrations.includes('zhipu-vision');

    const workingMessages: any[] = [
      { role: 'system', content: systemParts.join('\n\n---\n\n') },
      ...withMessageTimestamps(normalizedMessages),
    ];

    const encoder = new TextEncoder();
    let thinking = wantsThinking(requestedModel);

    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };
        const toolCtx: ToolRuntimeContext = {
          userAsk,
          send,
          credentials: {
            ...(notionAccessToken ? { notionAccessToken } : {}),
            ...(githubAccessToken ? { githubAccessToken } : {}),
            ...(googleAccessToken ? { googleAccessToken } : {}),
            ...(boundUserKey ? { skillsApiKey: boundUserKey } : {}),
          },
          requestSkills: Array.isArray(skills) ? skills : [],
          gateway: { apiKey, baseURL },
        };

        if (requestReview) {
          emitReviewerStep(send, { status: 'done', phase: 'requested' });
        }

        try {
          // Text-only model + images + zhipu-vision MCP: convert images → text first.
          // Vision models skip this — they receive image_url parts directly.
          let didImageUnderstand = false;
          if (zhipuVisionOn && !modelIsVision) {
            if (lastUserMessageHasImageParts(workingMessages)) {
              const { messages: rewritten, didUnderstand } =
                await rewriteMessagesWithImageDescriptions(
                  workingMessages,
                  { apiKey, baseURL },
                  { send, userAsk },
                );
              didImageUnderstand = didUnderstand;
              workingMessages.length = 0;
              workingMessages.push(...rewritten);
            }
          }

          let usedTools = false;
          const cursorModel = isCursorStyleModel(requestedModel);
          // cursor-auto often ignores OpenAI `tools` and only narrates “searching”.
          // For those models, run search server-side when the ask is clearly a lookup.
          const cursorProactiveSearch =
            searchEnabled &&
            cursorModel &&
            authorizedIntegrations.length === 0 &&
            looksLikeSearchRequest(userAsk);

          // Normally hand all tools to the model (tool_choice: auto).
          // Exception: this same request just ran Image Understand (server-side).
          // Chaining glm-4.7 tools+thinking right after a long vision call commonly
          // yields an empty/hung stream — UI shows "Image Understand" then silence.
          // Answer from the transcription first; follow-up turns still get full tools.
          const activeToolDefs = didImageUnderstand ? [] : toolDefs;
          if (activeToolDefs.length > 0 && modelNeedsThinkingForTools(requestedModel)) {
            thinking = true;
          }
          // Never fold reasoning into content server-side. The client always
          // receives them as separate SSE fields and shows reasoning in Process.
          // If only reasoning arrives (no content), the client promotes it at settle.
          const reasoningAsContent = false;

          const injectSearchOutcome = async (outcome: SearchOutcome) => {
            const callId = `proactive_search_${Date.now()}`;
            workingMessages.push({
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: callId,
                  type: 'function',
                  function: {
                    name: 'web_search',
                    arguments: JSON.stringify({ query: outcome.query }),
                  },
                },
              ],
            });
            workingMessages.push({
              role: 'tool',
              tool_call_id: callId,
              content: formatWebSearchToolContent(outcome, userAsk),
            });
            usedTools = true;
          };

          const runProactiveSearch = async (): Promise<boolean> => {
            let outcome = await runWebSearch(enrichSearchQuery(userAsk.slice(0, 240)), toolCtx);
            if (!outcome.results.length && /加密|币|项目|融资|最近|最新/.test(userAsk)) {
              outcome = await runWebSearch(
                englishRecencyQuery(
                  'cryptocurrency crypto funding rounds startups',
                  getClockContext(),
                  freshnessForQuery(userAsk) || 'month',
                ),
                toolCtx,
              );
            }
            if (!outcome.results.length) {
              const detail = outcome.error || 'All search providers failed';
              send({
                content: [
                  '联网搜索没有返回可用结果，所以我不能编造项目名单或假装查到了资料。',
                  '',
                  `查询：${outcome.query || userAsk}`,
                  `原因：${detail}`,
                ].join('\n'),
                ...streamCompletionPayload('stop'),
              });
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
              return false;
            }
            await injectSearchOutcome(outcome);
            return true;
          };

          if (cursorProactiveSearch) {
            // cursor-auto often ignores OpenAI `tools` and only narrates “searching”.
            // When the ask clearly needs lookup, search server-side first.
            if (!(await runProactiveSearch())) return;
          }

          // Generic tool loop — stream each round so content arrives
          // incrementally even when the model decides not to call tools.
          if (activeToolDefs.length > 0 && !usedTools) {
            for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
              let streamedContent = '';
              let streamedReasoning = '';
              // Accumulate streamed tool_calls: index → {id, name, arguments}
              const toolCallDeltas = new Map<number, { id: string; name: string; arguments: string }>();
              let roundFinishReason: string | null = null;
              const roundStampStripper = createStampLeakStripper();

              let streamIter: AsyncGenerator<any>;
              try {
                const raw = streamChatCompletionsRaw({
                  apiKey,
                  baseURL,
                  body: {
                    model: requestedModel,
                    temperature,
                    messages: sanitizeChatMessages(workingMessages),
                    tools: activeToolDefs,
                    tool_choice: 'auto',
                    ...(thinking ? { enable_thinking: true } : {}),
                  },
                });
                streamIter = (async function* () {
                  // Bound the whole tools round (create + stream) by timeout.
                  const iter = raw[Symbol.asyncIterator]();
                  const deadline = Date.now() + TOOLS_ROUND_TIMEOUT_MS;
                  while (true) {
                    const remaining = deadline - Date.now();
                    if (remaining <= 0) {
                      throw new Error(
                        `tools round timed out after ${TOOLS_ROUND_TIMEOUT_MS}ms`,
                      );
                    }
                    try {
                      const next = await withTimeout(
                        iter.next(),
                        remaining,
                        'tools round chunk',
                      );
                      if (next.done) break;
                      yield next.value;
                    } catch (chunkErr: unknown) {
                      const msg =
                        chunkErr instanceof Error
                          ? chunkErr.message
                          : String(chunkErr || 'failed');
                      // withTimeout reports the *remaining* slice (e.g. 90ms), which
                      // misleads the UI — always surface the full round budget.
                      if (/timed out/i.test(msg)) {
                        throw new Error(
                          `tools round timed out after ${TOOLS_ROUND_TIMEOUT_MS}ms`,
                        );
                      }
                      throw chunkErr;
                    }
                  }
                })();
              } catch (toolErr: any) {
                console.warn('tools round skipped:', toolErr?.message || toolErr);
                break;
              }

              // Whether we've seen any tool_call delta (used for post-stream routing).
              let hasToolCallDeltas = false;

              try {
                for await (const chunk of streamIter) {
                  const choice = chunk?.choices?.[0];
                  const delta = choice?.delta || {};
                  const finishReason = choice?.finish_reason || null;
                  if (finishReason) roundFinishReason = finishReason;

                  // --- tool_calls accumulation ---
                  if (Array.isArray(delta.tool_calls)) {
                    hasToolCallDeltas = true;
                    for (const tc of delta.tool_calls) {
                      const idx = tc.index ?? 0;
                      const existing = toolCallDeltas.get(idx) || { id: '', name: '', arguments: '' };
                      if (tc.id) existing.id = tc.id;
                      if (tc.function?.name) existing.name += tc.function.name;
                      if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                      toolCallDeltas.set(idx, existing);
                    }
                  }

                  // --- content / reasoning ---
                  // Always stream content as content, even after tool_call deltas start.
                  // Holding the tail back and replaying it as reasoning splits sentences
                  // across the bubble and a stray Thought step (e.g. "……手册" + Thought"版本。").
                  const split = splitCompletionDelta(delta, { reasoningAsContent });
                  let contentChunk = split.content;
                  if (split.reasoning) {
                    streamedReasoning += split.reasoning;
                    send({ reasoning: split.reasoning });
                  }

                  if (contentChunk) {
                    contentChunk = roundStampStripper.push(contentChunk);
                    if (contentChunk) {
                      streamedContent += contentChunk;
                      send({ content: contentChunk });
                    }
                  }
                }
              } catch (toolStreamErr: any) {
                // Timeout / upstream abort during streaming used to escape here and
                // surface as a hard "Request failed". Soft-fail: keep any partial
                // tool_calls / content and fall through to the same post-stream logic.
                console.warn(
                  'tools round stream aborted:',
                  toolStreamErr?.message || toolStreamErr,
                );
              }
              // Flush stamp stripper
              {
                const rest = roundStampStripper.flush();
                if (rest) {
                  streamedContent += rest;
                  send({ content: rest });
                }
              }

              // Build toolCalls array from accumulated deltas
              const toolCalls = [...toolCallDeltas.values()].filter((tc) => tc.name);

              if (!toolCalls.length) {
                // Cursor: narrated "I'll search" with no tool_calls → force real search.
                if (
                  cursorModel &&
                  searchEnabled &&
                  streamedContent &&
                  narratesSearchInsteadOfCalling(streamedContent)
                ) {
                  if (!(await runProactiveSearch())) return;
                  break;
                }
                // Claimed a tool success (Notion / GitHub / Google / web / skill)
                // without emitting tool_calls — Reviewer pushes a corrective turn.
                if (autoReview && streamedContent && round < MAX_TOOL_ROUNDS - 1) {
                  const faked = detectFakedToolNarration(streamedContent, {
                    searchEnabled,
                    integrations: authorizedIntegrations,
                    skillCreator: skillCreatorOn,
                  });
                  if (faked.length) {
                    emitReviewerStep(send, { status: 'done', phase: 'mid', surfaces: faked });
                    workingMessages.push({
                      role: 'assistant',
                      content: streamedContent,
                    });
                    workingMessages.push({
                      role: 'user',
                      content: buildCorrectionPrompt(faked),
                    });
                    break;
                  }
                }
                // Malformed / aborted tool_calls (e.g. deltas without a function name —
                // common on weaker free models). Content was already streamed as content.
                // Fall through to the final completion pass without tools.
                if (hasToolCallDeltas) {
                  break;
                }
                // Only end here when the model already streamed a user-visible answer.
                // Reasoning-only chunks (common on GLM with tools enabled) must fall
                // through to the final completion pass — otherwise the bubble stays empty.
                if (streamedContent.trim()) {
                  send(streamCompletionPayload(roundFinishReason || 'stop'));
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  controller.close();
                  return;
                }
                break;
              }

              // Tool calls present — any narration already landed in the bubble as content.
              // The follow-up answer still comes from the final stage after tools execute.

              usedTools = true;
              workingMessages.push({
                role: 'assistant',
                content: streamedContent || null,
                tool_calls: toolCalls.map((tc) => ({
                  id: tc.id,
                  type: 'function',
                  function: { name: tc.name, arguments: tc.arguments },
                })),
              });

              for (const tc of toolCalls) {
                const result = await executeRegisteredTool(
                  enabledTools,
                  {
                    name: tc.name,
                    callId: tc.id,
                    rawArguments: tc.arguments,
                    fallbackQuery: userAsk || streamedContent,
                  },
                  toolCtx,
                );
                workingMessages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: result.content,
                });
              }
            }
          }

          const finalMessages = usedTools
            ? [
                ...workingMessages,
                {
                  role: 'user',
                  content: [
                    'Write the final answer now using ONLY the tool results above.',
                    'Use the tool message payloads (web search and/or MCP integrations such as Notion, GitHub, Gmail, Google Calendar, and Google Drive). Do not invent facts the tools did not return.',
                    'If a web search payload includes strictWeek / requestedWindow / staleHint, follow those constraints.',
                    'Do NOT claim a “7-day / 本周” window unless userAsk explicitly asked for 一周/本周/this week.',
                    'Cite markdown links / Notion page URLs from tool results. Do not call tools. Do not say you are still searching.',
                  ].join(' '),
                },
              ]
            : workingMessages;

          const runFinalCompletion = async (opts: {
            enableThinking: boolean;
            foldReasoning: boolean;
          }) => {
            const finalStream = streamChatCompletionsRaw({
              apiKey,
              baseURL,
              body: {
                model: requestedModel,
                temperature,
                messages: sanitizeChatMessages(finalMessages),
                ...(opts.enableThinking ? { enable_thinking: true } : {}),
              },
            });

            let sawText = false;
            let sawContent = false;
            let lastFinishReason: string | null = null;
            let contentBuf = '';
            const stampStripper = createStampLeakStripper();
            let reasoningOnlyBuf = '';
            const iter = finalStream[Symbol.asyncIterator]();
            const deadline = Date.now() + FINAL_STREAM_TIMEOUT_MS;
            while (true) {
              const remaining = deadline - Date.now();
              if (remaining <= 0) throw new Error('final completion timed out');
              const next = await withTimeout(iter.next(), remaining, 'final completion');
              if (next.done) break;
              const chunk = next.value;
              const choice = chunk?.choices?.[0];
              const delta = choice?.delta || {};
              const finish_reason = choice?.finish_reason || null;
              if (finish_reason) lastFinishReason = finish_reason;

              let { content, reasoning } = splitCompletionDelta(delta, {
                reasoningAsContent: opts.foldReasoning,
              });

              if (content) content = stampStripper.push(content);
              if (finish_reason) {
                const rest = stampStripper.flush();
                if (rest) content = (content || '') + rest;
              }

              if (content) {
                sawText = true;
                sawContent = true;
                contentBuf += content;
              }
              if (reasoning) {
                sawText = true;
                reasoningOnlyBuf += reasoning;
              }
              if (content || reasoning) {
                send({
                  content: content || undefined,
                  reasoning: reasoning || undefined,
                });
              }
            }
            {
              const rest = stampStripper.flush();
              if (rest) {
                sawText = true;
                sawContent = true;
                contentBuf += rest;
                send({ content: rest });
              }
            }
            // Claim Reviewer post-audit: catch claims that slipped through to the
            // final text without tool receipts. Surface in Process; don't auto-run
            // another generation round.
            if (sawContent && autoReview) {
              const hits = detectFakedToolNarration(contentBuf, {
                searchEnabled,
                integrations: authorizedIntegrations,
                skillCreator: skillCreatorOn,
              });
              if (hits.length) {
                emitReviewerStep(send, {
                  status: 'done',
                  phase: requestReview && !autoReview ? 'requested' : 'audit',
                  surfaces: hits,
                });
              }
            }
            // If reasoning arrived but no content, do NOT fold server-side.
            // The client promotes orphan reasoning → content at settle time,
            // preserving the proper Process / answer split.
            if (!sawContent && reasoningOnlyBuf.trim()) {
              sawText = true;
            }
            return { sawText, sawContent, lastFinishReason };
          };

          let finalResult = await runFinalCompletion({
            enableThinking: thinking,
            foldReasoning: false,
          });

          // Some models return a totally empty stream on the first pass (seen on
          // GLM after Image Understand; also weaker free models with tools). Retry
          // once without thinking — still keep reasoning separate (client promotes).
          if (!finalResult.sawText) {
            console.warn('empty final completion; retrying without thinking', requestedModel);
            finalResult = await runFinalCompletion({
              enableThinking: false,
              foldReasoning: false,
            });
          }

          if (!finalResult.sawText) {
            send({
              content:
                'Error: The model returned an empty reply. Please try again, or switch to another model.',
              ...streamCompletionPayload('error'),
            });
          } else {
            send(streamCompletionPayload(finalResult.lastFinishReason || 'stop'));
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (err: any) {
          try {
            send({
              content: `\n\nError: ${err?.message || 'Upstream model request failed.'}`,
              ...streamCompletionPayload('error'),
            });
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch {
            controller.error(err);
          }
        }
      },
    });

    const responseHeaders = {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Vercel-AI-Data-Stream': 'v1',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Enabled-Integrations': authorizedIntegrations.join(',') || 'none',
      ...(googleRequestedButUnauthorized
        ? { 'X-Google-Auth': 'requested-but-unauthorized' }
        : {}),
    };

    if (notionVaultUpdate && notionOwnerId) {
      const cookieCarrier = new NextResponse(stream, { headers: responseHeaders });
      await upsertNotionConnection(req, cookieCarrier, notionOwnerId, notionVaultUpdate);
      if (googleVaultUpdate && googleOwnerId) {
        await upsertGoogleConnection(req, cookieCarrier, googleOwnerId, googleVaultUpdate);
      }
      return cookieCarrier;
    }

    if (googleVaultUpdate && googleOwnerId) {
      const cookieCarrier = new NextResponse(stream, { headers: responseHeaders });
      await upsertGoogleConnection(req, cookieCarrier, googleOwnerId, googleVaultUpdate);
      return cookieCarrier;
    }

    return new NextResponse(stream, { headers: responseHeaders });
  } catch (err: any) {
    console.error('chat route error:', err);
    const status = err?.status || err?.statusCode || err?.response?.status;
    const detail =
      err?.error?.message || err?.message || String(err || 'Upstream model request failed.');
    return jsonError(`${detail}${status ? ` (HTTP ${status})` : ''}`);
  }
}
