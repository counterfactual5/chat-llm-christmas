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
  detectPendingToolIntent,
  buildCorrectionPrompt,
  buildPendingIntentPrompt,
  buildExecutionRecordFromMessages,
  buildExecutionRecordFromToolRuns,
  runFullClaimAudit,
  emitMidTurnReview,
  emitReviewReport,
  buildReviewReport,
  buildFindingsResponsePrompt,
  buildReviewIssuesResponsePrompt,
  actionableReviewIssues,
  verifyCorrectionText,
  rejectedCorrectionNote,
  lastUserMessageIndex,
  synthesizeFindings,
  FINDINGS_RESPONSE_SYSTEM,
  REVIEWER_SYSTEM_PROMPT,
  type ReviewFinding,
  type ReviewIssue,
  type ClaimAuditResult,
  type MidTurnCorrection,
} from '@/lib/claim-reviewer';
import { isSkillCreatorId } from '@/lib/skill-creator';

export const runtime = 'edge';
export const maxDuration = 300;

const MAX_TOOL_ROUNDS = 3;
/** Stall budget: no upstream chunk for this long → timeout. */
const STREAM_IDLE_TIMEOUT_MS = 90_000;
/** Hard cap for one streaming pass (under maxDuration). */
const STREAM_MAX_TOTAL_MS = 240_000;
/** @deprecated use STREAM_IDLE_TIMEOUT_MS — kept for error message parity in tools round */
const TOOLS_ROUND_TIMEOUT_MS = STREAM_IDLE_TIMEOUT_MS;
const VERIFIER_TIMEOUT_MS = 25_000;

function streamWaitBudget(opts: {
  startedAt: number;
  lastChunkAt: number;
  idleMs: number;
  maxTotalMs: number;
}): number {
  const idleRemaining = opts.idleMs - (Date.now() - opts.lastChunkAt);
  const totalRemaining = opts.maxTotalMs - (Date.now() - opts.startedAt);
  return Math.min(idleRemaining, totalRemaining);
}

function streamTimeoutError(label: string, idleMs: number, maxTotalMs: number, startedAt: number, lastChunkAt: number): Error {
  const stalledFor = Date.now() - lastChunkAt;
  const totalFor = Date.now() - startedAt;
  if (totalFor >= maxTotalMs) {
    return new Error(`${label} exceeded ${Math.round(maxTotalMs / 1000)}s total budget`);
  }
  return new Error(`${label} stalled for ${Math.round(stalledFor / 1000)}s (no upstream chunks)`);
}

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
  signal?: AbortSignal;
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
      signal: opts.signal,
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
    if (opts.signal?.aborted) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
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

/** Non-streaming completion for the isolated claim verifier. */
async function completeOnce(opts: {
  apiKey: string;
  baseURL: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const res = await fetch(`${opts.baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: opts.temperature ?? 0,
      stream: false,
      messages: opts.messages,
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Verifier upstream error: ${res.status} ${(errText || res.statusText).slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => String(p?.text || '')).join('');
  }
  return '';
}

export async function POST(req: NextRequest) {
  try {
    const clientSignal = req.signal;
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
      /** Prior assistant turn(s) to audit (request review). */
      reviewContext = null as null | {
        targetMessageId?: string;
        assistantText?: string;
        toolRuns?: Array<{
          name: string;
          status: string;
          query?: string;
          error?: string;
          provider?: string;
          results?: Array<{
            url?: string;
            title?: string;
            snippet?: string;
            body?: string;
          }>;
        }>;
        /** Full-thread Request Review: each assistant turn + its own receipts. */
        turns?: Array<{
          messageId: string;
          assistantText: string;
          toolRuns?: Array<{
            name: string;
            status: string;
            query?: string;
            error?: string;
            provider?: string;
            results?: Array<{
              url?: string;
              title?: string;
              snippet?: string;
              body?: string;
            }>;
          }>;
        }>;
      },
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
        'The user explicitly requested a claim review of the conversation. Verify each assistant turn against that turn’s own tool receipts (not a pooled bag of all tools). If a claim lacks a real tool receipt for its turn, retract it. Otherwise confirm briefly.',
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
    const hasGeneratedFiles = (messages as any[]).some(
      (m) => m?.role === 'assistant' && Array.isArray(m.files) && m.files.length > 0,
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
    if (hasGeneratedFiles) {
      systemParts.push(
        [
          'This chat already contains downloadable file(s) created via create_file.',
          'They appear in the Output panel. Refer to those existing files when the user asks about them.',
          'To add more files, call create_file again — do not pretend a file exists without a successful create_file receipt.',
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

      // Replay prior-turn tool receipts so the model can see what actually ran.
      if (role === 'tool') {
        normalizedMessages.push({
          role: 'tool',
          tool_call_id: String(m.tool_call_id || ''),
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
          timestamp,
        });
        continue;
      }

      if (role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        normalizedMessages.push({
          role: 'assistant',
          content:
            typeof m.content === 'string' && m.content.length > 0 ? m.content : null,
          tool_calls: m.tool_calls,
          timestamp,
        });
        continue;
      }

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
          const auditOpts = {
            searchEnabled,
            integrations: authorizedIntegrations,
            skillCreator: skillCreatorOn,
          };
          const priorText = String(reviewContext?.assistantText || '').trim();
          const verifierComplete = async (
            msgs: Array<{ role: string; content: string }>,
          ) =>
            withTimeout(
              completeOnce({
                apiKey,
                baseURL,
                model: requestedModel,
                messages: msgs,
                temperature: 0,
                signal: clientSignal,
              }),
              VERIFIER_TIMEOUT_MS,
              'claim verifier',
            );

          type ReviewToolRun = NonNullable<
            NonNullable<typeof reviewContext>['toolRuns']
          >[number];
          type ReviewTurn = {
            messageId: string;
            assistantText: string;
            toolRuns?: ReviewToolRun[];
          };
          const rawTurns = Array.isArray(reviewContext?.turns)
            ? reviewContext!.turns!
            : [];
          const turns: ReviewTurn[] = rawTurns
            .map((t: { messageId?: string; assistantText?: string; toolRuns?: ReviewToolRun[] }) => ({
              messageId: String(t?.messageId || '').trim(),
              assistantText: String(t?.assistantText || '').trim(),
              toolRuns: t?.toolRuns,
            }))
            .filter((t: ReviewTurn) => t.messageId && t.assistantText);
          // Backward compat: single-turn payload without `turns`.
          if (!turns.length && priorText) {
            turns.push({
              messageId: String(reviewContext?.targetMessageId || '').trim() || 'last',
              assistantText: priorText,
              toolRuns: reviewContext?.toolRuns,
            });
          }

          let findings: ReviewFinding[] = [];
          let reviewIssues: ReviewIssue[] = [];
          try {
            if (turns.length) {
              const focusId =
                String(reviewContext?.targetMessageId || '').trim() ||
                turns[turns.length - 1]!.messageId;
              for (const turn of turns) {
                const priorRecord = buildExecutionRecordFromToolRuns(turn.toolRuns || []);
                // Spend the LLM verifier on the focused (usually latest) turn, and
                // on earlier turns only when local heuristics already found errors.
                const earlyErrors = synthesizeFindings(
                  turn.assistantText,
                  priorRecord,
                  auditOpts,
                ).some((f) => f.severity === 'error');
                const audit = await runFullClaimAudit(
                  send,
                  turn.assistantText,
                  priorRecord,
                  auditOpts,
                  'requested',
                  verifierComplete,
                  {
                    forceLlm: turn.messageId === focusId || earlyErrors,
                    targetMessageId: turn.messageId,
                    emitEmpty: true,
                    userAsk,
                    signal: clientSignal,
                  },
                );
                findings = findings.concat(audit.findings);
                reviewIssues = reviewIssues.concat(audit.issues);
              }
            } else {
              emitReviewReport(
                send,
                buildReviewReport({
                  assistantText: '',
                  record: [],
                  findings: [],
                  phase: 'requested',
                }),
                reviewContext?.targetMessageId,
              );
            }

            // Dedicated response path: address findings only (no tools / no persona bleed).
            const reviewMessages = [
              { role: 'system', content: FINDINGS_RESPONSE_SYSTEM },
              {
                role: 'user',
                content: reviewIssues.length
                  ? buildReviewIssuesResponsePrompt(reviewIssues, priorText || turns.map((t) => t.assistantText).join('\n\n'))
                  : buildFindingsResponsePrompt(findings, priorText || turns.map((t) => t.assistantText).join('\n\n')),
              },
            ];
            const reviewStream = streamChatCompletionsRaw({
              apiKey,
              baseURL,
              signal: clientSignal,
              body: {
                model: requestedModel,
                temperature: 0.3,
                messages: sanitizeChatMessages(reviewMessages),
              },
            });
            let sawText = false;
            let lastFinishReason: string | null = null;
            const stampStripper = createStampLeakStripper();
            for await (const chunk of reviewStream) {
              const choice = chunk?.choices?.[0];
              const delta = choice?.delta || {};
              const finish_reason = choice?.finish_reason || null;
              if (finish_reason) lastFinishReason = finish_reason;
              let { content, reasoning } = splitCompletionDelta(delta, {
                reasoningAsContent: false,
              });
              if (content) content = stampStripper.push(content);
              if (finish_reason) {
                const rest = stampStripper.flush();
                if (rest) content = (content || '') + rest;
              }
              if (content) {
                sawText = true;
                send({ content });
              }
              if (reasoning) {
                sawText = true;
                send({ reasoning });
              }
            }
            {
              const rest = stampStripper.flush();
              if (rest) {
                sawText = true;
                send({ content: rest });
              }
            }
            if (!sawText) {
              send({
                content: findings.length
                  ? 'Review complete — see Findings above. Retract any unsupported claims listed there.'
                  : 'Review complete — no unsupported tool claims found against the execution record.',
              });
            }
            send(streamCompletionPayload(lastFinishReason || 'stop'));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            return;
          } catch (err: any) {
            if (err?.name === 'AbortError' || clientSignal.aborted) {
              try {
                send(streamCompletionPayload('stop'));
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
              } catch {
                /* already closed */
              }
              return;
            }
            send({
              content: `\n\nError: ${err?.message || 'Claim review failed.'}`,
              ...streamCompletionPayload('error'),
            });
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            return;
          }
        }

        const auditOpts = {
          searchEnabled,
          integrations: authorizedIntegrations,
          skillCreator: skillCreatorOn,
        };
        let midTurnCorrection: MidTurnCorrection | null = null;
        // Snapshot before this turn's tool rounds so Auto-review ignores
        // historically replayed receipts from earlier assistant turns.
        const autoReviewTurnBoundary = lastUserMessageIndex(workingMessages);
        const verifierComplete = async (
          msgs: Array<{ role: string; content: string }>,
        ) =>
          withTimeout(
            completeOnce({
              apiKey,
              baseURL,
              model: requestedModel,
              messages: msgs,
              temperature: 0,
              signal: clientSignal,
            }),
            VERIFIER_TIMEOUT_MS,
            'claim verifier',
          );

        const emptyAudit = (): ClaimAuditResult => ({
          findings: [],
          report: { phase: 'audit', status: 'done', checks: [] },
          issues: [],
        });

        const postAudit = async (
          text: string,
          phase: 'audit' | 'requested' = 'audit',
          meta?: { finishReason?: string | null; truncated?: boolean },
        ): Promise<ClaimAuditResult> => {
          if (!autoReview) return emptyAudit();
          if (clientSignal.aborted) {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            throw err;
          }
          const record = buildExecutionRecordFromMessages(workingMessages, {
            afterIndex: autoReviewTurnBoundary,
          });
          return runFullClaimAudit(
            send,
            text,
            record,
            auditOpts,
            phase,
            verifierComplete,
            {
              forceLlm: false,
              midTurn: midTurnCorrection,
              userAsk,
              finishReason: meta?.finishReason ?? null,
              truncated: meta?.truncated,
              signal: clientSignal,
            },
          );
        };

        /** After review finds issues, ask the main model for a short delta fix (not a full rewrite). */
        const streamReviewCorrection = async (
          issues: ReviewIssue[],
          priorText: string,
        ) => {
          if (!issues.length || clientSignal.aborted) return false;
          send({ review_fix: { status: 'start' } });
          const correctionMessages = [
            { role: 'system', content: FINDINGS_RESPONSE_SYSTEM },
            {
              role: 'user',
              content: buildReviewIssuesResponsePrompt(issues, priorText),
            },
          ];
          const correctionStream = streamChatCompletionsRaw({
            apiKey,
            baseURL,
            signal: clientSignal,
            body: {
              model: requestedModel,
              temperature: 0.2,
              messages: sanitizeChatMessages(correctionMessages),
            },
          });
          // Buffer the whole draft, then verify locally — streaming a bad
          // correction to the user is worse than a short delay.
          let draft = '';
          const stampStripper = createStampLeakStripper();
          for await (const chunk of correctionStream) {
            if (clientSignal.aborted) break;
            const choice = chunk?.choices?.[0];
            const delta = choice?.delta || {};
            const finish_reason = choice?.finish_reason || null;
            let { content } = splitCompletionDelta(delta, { reasoningAsContent: false });
            if (content) content = stampStripper.push(content);
            if (finish_reason) {
              const rest = stampStripper.flush();
              if (rest) content = (content || '') + rest;
            }
            if (content) draft += content;
          }
          if (!clientSignal.aborted) {
            const rest = stampStripper.flush();
            if (rest) draft += rest;
          }

          const verified = verifyCorrectionText(draft, {
            priorLength: String(priorText || '').length,
          });
          const out = verified.ok
            ? verified.text
            : rejectedCorrectionNote(verified.reason || 'failed local checks');
          if (out) send({ review_fix: { content: out } });
          send({ review_fix: { status: 'done' } });
          return Boolean(out);
        };

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
          let lastToolRoundHadFailure = false;
          const cursorModel = isCursorStyleModel(requestedModel);
          // cursor-auto often ignores OpenAI `tools` and only narrates “searching”.
          // For those models, run search server-side when the ask is clearly a lookup.
          const cursorProactiveSearch =
            searchEnabled &&
            cursorModel &&
            authorizedIntegrations.length === 0 &&
            looksLikeSearchRequest(userAsk);

          // Normally hand all tools to the model (tool_choice: auto).
          // After Image Understand on this same request: keep web_read/search/etc.
          // so the model can still open links the user pasted. Only drop
          // image_understand (pixels are already transcribed). Stripping ALL
          // tools here caused empty replies on free text models (e.g. hy3-free)
          // that wanted to fetch the page — Retry then worked because the
          // client had persisted the transcription and tools were back on.
          const activeToolDefs = didImageUnderstand
            ? toolDefs.filter((t) => t?.function?.name !== 'image_understand')
            : toolDefs;
          if (didImageUnderstand) {
            // Long vision then tools+thinking → empty/hung stream on some GLM
            // routes. Keep tools, but skip thinking for this turn.
            thinking = false;
          } else if (
            activeToolDefs.length > 0 &&
            modelNeedsThinkingForTools(requestedModel)
          ) {
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
                  signal: clientSignal,
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
                  // Bound each tools round by idle stall + total wall clock.
                  const iter = raw[Symbol.asyncIterator]();
                  const startedAt = Date.now();
                  let lastChunkAt = startedAt;
                  while (true) {
                    const remaining = streamWaitBudget({
                      startedAt,
                      lastChunkAt,
                      idleMs: STREAM_IDLE_TIMEOUT_MS,
                      maxTotalMs: STREAM_MAX_TOTAL_MS,
                    });
                    if (remaining <= 0) {
                      throw streamTimeoutError(
                        'tools round',
                        STREAM_IDLE_TIMEOUT_MS,
                        STREAM_MAX_TOTAL_MS,
                        startedAt,
                        lastChunkAt,
                      );
                    }
                    try {
                      const next = await withTimeout(
                        iter.next(),
                        remaining,
                        'tools round chunk',
                      );
                      if (next.done) break;
                      lastChunkAt = Date.now();
                      yield next.value;
                    } catch (chunkErr: unknown) {
                      const msg =
                        chunkErr instanceof Error
                          ? chunkErr.message
                          : String(chunkErr || 'failed');
                      if (/timed out/i.test(msg)) {
                        throw streamTimeoutError(
                          'tools round',
                          STREAM_IDLE_TIMEOUT_MS,
                          STREAM_MAX_TOTAL_MS,
                          startedAt,
                          lastChunkAt,
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
                // Announced "I'll fetch/read first" with no tool_calls — force a real call.
                // Always on when those tools are available (not only Auto-review): otherwise
                // the turn ends on narration and the UI looks "interrupted".
                if (streamedContent && round < MAX_TOOL_ROUNDS - 1) {
                  const pending = detectPendingToolIntent(streamedContent, {
                    searchEnabled,
                    integrations: authorizedIntegrations,
                  });
                  if (pending.length) {
                    midTurnCorrection = { surfaces: pending, kind: 'intent' };
                    emitMidTurnReview(send, midTurnCorrection);
                    workingMessages.push({
                      role: 'assistant',
                      content: streamedContent,
                    });
                    workingMessages.push({
                      role: 'user',
                      content: buildPendingIntentPrompt(pending),
                    });
                    break;
                  }
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
                    midTurnCorrection = { surfaces: faked, kind: 'success' };
                    emitMidTurnReview(send, midTurnCorrection);
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
                  // After a failed tool, narration without a retry is incomplete —
                  // push a recovery turn while rounds remain so the model can fix args
                  // (e.g. missing Notion page_id) instead of leaving a half outline.
                  if (lastToolRoundHadFailure && round < MAX_TOOL_ROUNDS - 1) {
                    workingMessages.push({
                      role: 'assistant',
                      content: streamedContent,
                    });
                    workingMessages.push({
                      role: 'user',
                      content: [
                        'Your previous tool call(s) FAILED — see the tool result error payloads above.',
                        'Either emit corrected tool_calls now (e.g. include required fields like page_id),',
                        'OR clearly explain the failure and stop. Do not claim the write succeeded.',
                        'Do not leave a half-written outline or empty section headings.',
                      ].join(' '),
                    });
                    lastToolRoundHadFailure = false;
                    break;
                  }
                  // Early DONE used to skip runFinalCompletion entirely — so Auto-review
                  // post-audit never ran on "model said stop after narration" turns.
                  // Soft-audit here for visibility; mid-turn correction above should
                  // already have forced tool_calls when rounds remain.
                  if (autoReview) {
                    const audit = await postAudit(streamedContent, 'audit', {
                      finishReason: roundFinishReason,
                      truncated: roundFinishReason === 'length',
                    });
                    // Warn-level heuristics stay panel-only; only verified
                    // errors are worth making the model amend itself.
                    const actionable = actionableReviewIssues(audit.issues);
                    if (actionable.length) {
                      await streamReviewCorrection(actionable, streamedContent);
                    }
                  }
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
              let roundHadToolFailure = false;
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
                // Prefer a concrete URL from recent tool payloads when web_read
                // omits `url` (common on free models that confuse it with search).
                let fallbackQuery = userAsk || streamedContent;
                if (/^web[_-]?read$/i.test(tc.name)) {
                  const fromArgs = String(tc.arguments || '');
                  const fromHistory = workingMessages
                    .slice(-12)
                    .filter((m) => m?.role === 'tool')
                    .map((m) => String(m.content || ''))
                    .join('\n');
                  fallbackQuery = [fromArgs, streamedContent, fromHistory, userAsk]
                    .filter(Boolean)
                    .join('\n');
                }
                const result = await executeRegisteredTool(
                  enabledTools,
                  {
                    name: tc.name,
                    callId: tc.id,
                    rawArguments: tc.arguments,
                    fallbackQuery,
                  },
                  toolCtx,
                );
                const payload = String(result.content || '');
                if (
                  /"ok"\s*:\s*false/i.test(payload) ||
                  /"error"\s*:\s*"/i.test(payload) ||
                  /MCP error|Input validation error|invalid_type/i.test(payload)
                ) {
                  roundHadToolFailure = true;
                }
                workingMessages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: result.content,
                });
              }
              if (roundHadToolFailure) lastToolRoundHadFailure = true;
            }
          }

          const finalMessages = usedTools
            ? [
                ...workingMessages,
                {
                  role: 'user',
                  content: lastToolRoundHadFailure
                    ? [
                        'Write the final answer now.',
                        'One or more tools FAILED — acknowledge the error from the tool payloads honestly.',
                        'Do not claim Notion/GitHub/Google writes succeeded. Do not invent page URLs.',
                        'If you can tell the user how to fix the args (e.g. missing page_id), do so briefly.',
                        'Do not leave half-written outlines or empty section headings. Do not call tools.',
                      ].join(' ')
                    : [
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
            messages?: any[];
          }) => {
            const finalStream = streamChatCompletionsRaw({
              apiKey,
              baseURL,
              signal: clientSignal,
              body: {
                model: requestedModel,
                temperature,
                messages: sanitizeChatMessages(opts.messages || finalMessages),
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
            const startedAt = Date.now();
            let lastChunkAt = startedAt;
            while (true) {
              const remaining = streamWaitBudget({
                startedAt,
                lastChunkAt,
                idleMs: STREAM_IDLE_TIMEOUT_MS,
                maxTotalMs: STREAM_MAX_TOTAL_MS,
              });
              if (remaining <= 0) {
                throw streamTimeoutError(
                  'final completion',
                  STREAM_IDLE_TIMEOUT_MS,
                  STREAM_MAX_TOTAL_MS,
                  startedAt,
                  lastChunkAt,
                );
              }
              let next;
              try {
                next = await withTimeout(iter.next(), remaining, 'final completion');
              } catch (chunkErr: unknown) {
                const msg =
                  chunkErr instanceof Error ? chunkErr.message : String(chunkErr || 'failed');
                if (/timed out/i.test(msg)) {
                  throw streamTimeoutError(
                    'final completion',
                    STREAM_IDLE_TIMEOUT_MS,
                    STREAM_MAX_TOTAL_MS,
                    startedAt,
                    lastChunkAt,
                  );
                }
                throw chunkErr;
              }
              if (next.done) break;
              lastChunkAt = Date.now();
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
            // final text without tool receipts. Surface Findings; auto-correct errors.
            let auditResult: ClaimAuditResult = emptyAudit();
            if (sawContent && autoReview) {
              auditResult = await postAudit(contentBuf, 'audit', {
                finishReason: lastFinishReason,
                truncated: lastFinishReason === 'length',
              });
            }
            // If reasoning arrived but no content, do NOT fold server-side.
            // The client promotes orphan reasoning → content at settle time,
            // preserving the proper Process / answer split.
            if (!sawContent && reasoningOnlyBuf.trim()) {
              sawText = true;
            }
            return { sawText, sawContent, lastFinishReason, contentBuf, auditResult };
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

          // After server-side Image Understand, a few free models still return an
          // empty final stream even though the transcription is in context. Nudge
          // once in-request so the user does not need a manual Retry.
          if (!finalResult.sawText && didImageUnderstand) {
            console.warn(
              'empty final completion after image understand; nudging',
              requestedModel,
            );
            finalResult = await runFinalCompletion({
              enableThinking: false,
              foldReasoning: false,
              messages: [
                ...workingMessages,
                {
                  role: 'user',
                  content: [
                    'The image has already been transcribed into the prior user message.',
                    'Answer the user now using that transcription and any URLs they shared.',
                    'Do not say you cannot see the image. Do not call tools.',
                  ].join(' '),
                },
              ],
            });
          }

          {
            // Warn-level heuristics stay panel-only; only verified errors are
            // worth making the model amend itself (false warns make it cave).
            const actionable = actionableReviewIssues(finalResult.auditResult.issues);
            if (finalResult.sawContent && actionable.length) {
              await streamReviewCorrection(actionable, finalResult.contentBuf);
            }
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
          if (err?.name === 'AbortError' || clientSignal.aborted) {
            try {
              send(streamCompletionPayload('stop'));
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            } catch {
              /* already closed */
            }
            return;
          }
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
