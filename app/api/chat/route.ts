import OpenAI from 'openai';
import { NextRequest } from 'next/server';
import { fetchFreeModelNames, looksFreeByName } from '@/lib/pricing';
import {
  CURSOR_WEB_CHAT_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  conversationIsolationPrompt,
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
  resolveEnabledTools,
  runWebSearch,
  toolSystemPrompt,
  type ToolRuntimeContext,
} from '@/lib/tools';
import { getNotionAccessToken, resolveOwnerId } from '@/lib/integrations';

export const runtime = 'edge';
export const maxDuration = 300;

const MAX_TOOL_ROUNDS = 3;
const TOOLS_ROUND_TIMEOUT_MS = 45_000;

function jsonError(message: string, status: number = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function wantsThinking(model: string) {
  return (
    /(^|[-_])(r1|reason|thinking|qwq)([-_]|$)/i.test(model) ||
    /deepseek-v4|glm-5|kimi-k2\.|minimax-m3/i.test(model)
  );
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
    const requestedIntegrations = Array.isArray(integrations)
      ? integrations.map((x: unknown) => String(x || '').trim().toLowerCase()).filter(Boolean)
      : [];
    // Intersect client toggles with vault OAuth — never trust integrations alone.
    const authorizedIntegrations: string[] = [];
    if (requestedIntegrations.includes('notion') && isBoundAccount) {
      const ownerId = await resolveOwnerId(req);
      if (ownerId && (await getNotionAccessToken(req, ownerId))) {
        authorizedIntegrations.push('notion');
      }
    }
    // Only tools for integrations the user enabled *and* authorized enter the
    // model context (definitions + system guidance). Off / unlinked ⇒ not included.
    const enabledTools = resolveEnabledTools({
      searchEnabled,
      integrations: authorizedIntegrations,
    });
    const toolDefs = openaiToolDefinitions(enabledTools);
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
    if (String(referenceText || '').trim()) {
      systemParts.push(
        `Reference material provided by the user. Treat it as authoritative context:\n\n${String(referenceText).trim()}`,
      );
    }

    const normalizedMessages = (messages as any[]).map((m) => {
      const role = m.role;
      const timestamp = m.timestamp;
      if (Array.isArray(m.content)) {
        return { role, content: m.content, timestamp };
      }
      const text = typeof m.content === 'string' ? m.content : '';
      const images: string[] = Array.isArray(m.images)
        ? m.images.map((img: any) => (typeof img === 'string' ? img : img?.url)).filter(Boolean)
        : [];
      if (images.length === 0) {
        return { role, content: text, timestamp };
      }
      return {
        role,
        timestamp,
        content: [
          ...(text ? [{ type: 'text', text }] : []),
          ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      };
    });

    const userAsk = lastUserText(normalizedMessages);

    const workingMessages: any[] = [
      { role: 'system', content: systemParts.join('\n\n---\n\n') },
      ...withMessageTimestamps(normalizedMessages),
    ];

    const encoder = new TextEncoder();
    const thinking = wantsThinking(requestedModel);

    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };
        const toolCtx: ToolRuntimeContext = { userAsk, send };

        try {
          let usedTools = false;
          const cursorModel = isCursorStyleModel(requestedModel);
          // cursor-auto often ignores OpenAI `tools` and only narrates “searching”.
          // For those models, run search server-side when the ask is clearly a lookup.
          const cursorProactiveSearch =
            searchEnabled && cursorModel && looksLikeSearchRequest(userAsk);

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
                finish_reason: 'stop',
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

          // Generic tool loop — tools come from the registry (web_search today, MCP later).
          if (toolDefs.length > 0 && !usedTools) {
            for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
              let completion: any;
              try {
                completion = await withTimeout(
                  openai.chat.completions.create({
                    model: requestedModel,
                    temperature,
                    stream: false,
                    messages: workingMessages,
                    tools: toolDefs,
                    tool_choice: 'auto',
                    ...(thinking ? { enable_thinking: true } : {}),
                  } as any),
                  TOOLS_ROUND_TIMEOUT_MS,
                  'tools round',
                );
              } catch (toolErr: any) {
                console.warn('tools round skipped:', toolErr?.message || toolErr);
                break;
              }

              const choice = completion?.choices?.[0];
              const message = choice?.message || {};
              const toolCalls = extractToolCalls(message);
              const content =
                typeof message.content === 'string'
                  ? message.content
                  : Array.isArray(message.content)
                    ? message.content.map((p: any) => p?.text || p?.content || '').join('')
                    : '';
              const reasoning =
                message.reasoning_content ||
                message.reasoning ||
                message.thinking ||
                message.thinking_content ||
                '';

              if (reasoning) send({ reasoning: String(reasoning) });

              if (!toolCalls.length) {
                // Cursor: narrated “I'll search” with no tool_calls → force real search.
                if (
                  cursorModel &&
                  searchEnabled &&
                  content &&
                  narratesSearchInsteadOfCalling(content)
                ) {
                  send({ reasoning: String(content) });
                  if (!(await runProactiveSearch())) return;
                  break;
                }
                // Plain answer without tools — finish (avoid a second stream that can hang).
                if (content) send({ content: stripMessageStamp(String(content)) });
                if (content || reasoning) {
                  send({ finish_reason: choice?.finish_reason || 'stop' });
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  controller.close();
                  return;
                }
                break;
              }

              if (content) send({ content: stripMessageStamp(String(content)) });

              usedTools = true;
              workingMessages.push({
                role: 'assistant',
                content: content || null,
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
                    fallbackQuery: userAsk || content,
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
                    'The previous tool message contains the search hits — use them. Do not say tools returned nothing when results.length > 0.',
                    'Follow strictWeek / requestedWindow / staleHint in that payload.',
                    'Do NOT claim a “7-day / 本周” window unless userAsk explicitly asked for 一周/本周/this week.',
                    'Cite markdown links. Do not call tools. Do not say you are still searching.',
                  ].join(' '),
                },
              ]
            : workingMessages;

          const final = await openai.chat.completions.create({
            model: requestedModel,
            temperature,
            stream: true,
            messages: finalMessages,
            ...(thinking ? { enable_thinking: true } : {}),
          } as any);

          let sawText = false;
          const stampStripper = createStampLeakStripper();
          for await (const chunk of final as any) {
            const choice = chunk?.choices?.[0];
            const delta = choice?.delta || {};
            const finish_reason = choice?.finish_reason || null;

            let content = '';
            let reasoning = '';

            if (typeof delta.content === 'string') {
              content = delta.content;
            } else if (Array.isArray(delta.content)) {
              for (const part of delta.content) {
                const type = String(part?.type || '');
                if (type === 'thinking' || type === 'reasoning') {
                  reasoning += part.thinking || part.reasoning || part.text || '';
                } else if (type === 'text' || !type) {
                  content += part.text || part.content || '';
                }
              }
            }

            reasoning +=
              delta.reasoning_content ||
              delta.reasoning ||
              delta.thinking ||
              delta.thinking_content ||
              '';

            if (content) content = stampStripper.push(content);
            if (finish_reason) {
              const rest = stampStripper.flush();
              if (rest) content = (content || '') + rest;
            }

            if (content) sawText = true;
            if (reasoning) sawText = true;
            if (content || reasoning || finish_reason) {
              send({
                content: content || undefined,
                reasoning: reasoning || undefined,
                finish_reason,
              });
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
              content:
                'Error: The model returned an empty reply. Please try again, or switch to another model.',
              finish_reason: 'error',
            });
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (err: any) {
          try {
            send({
              content: `\n\nError: ${err?.message || 'Upstream model request failed.'}`,
              finish_reason: 'error',
            });
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch {
            controller.error(err);
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Vercel-AI-Data-Stream': 'v1',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err: any) {
    console.error('chat route error:', err);
    const status = err?.status || err?.statusCode || err?.response?.status;
    const detail =
      err?.error?.message || err?.message || String(err || 'Upstream model request failed.');
    return jsonError(`${detail}${status ? ` (HTTP ${status})` : ''}`);
  }
}
