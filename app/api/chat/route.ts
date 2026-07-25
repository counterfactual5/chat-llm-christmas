import OpenAI from 'openai';
import { NextRequest } from 'next/server';
import { fetchFreeModelNames, looksFreeByName } from '@/lib/pricing';
import {
  CURSOR_WEB_CHAT_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  conversationIsolationPrompt,
  isCursorStyleModel,
} from '@/lib/model-specs';
import {
  WEB_SEARCH_TOOL,
  formatSearchResultsForModel,
  webSearch,
  type SearchOutcome,
} from '@/lib/web-search';
import {
  englishRecencyQuery,
  enrichSearchQuery,
  freshnessForQuery,
  getClockContext,
  stampMessageText,
  stripMessageStamp,
  timeContextSystemPrompt,
} from '@/lib/time-context';

export const runtime = 'edge';
export const maxDuration = 300;

const MAX_TOOL_ROUNDS = 2;
const TOOLS_ROUND_TIMEOUT_MS = 20_000;

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

/** User phrasing that usually needs live web results. */
function looksLikeSearchRequest(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  return /查一下|帮我查|搜一下|搜索|查找|找一下|最近.*项目|最新|新闻|行情|price|search|look\s*up|find\s+(me\s+)?(the\s+)?(latest|recent)|what.*(happening|new)|google/i.test(
    t,
  );
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

/** Stamp user/assistant turns with real send time for the model (not shown in UI). */
function withMessageTimestamps(messages: any[]): any[] {
  return messages.map((m) => {
    if (m?.role !== 'user' && m?.role !== 'assistant') return m;
    const ts = parseTimestampMs(m.timestamp);
    if (typeof m.content === 'string') {
      return { ...m, content: stampMessageText(m.content, ts) };
    }
    if (Array.isArray(m.content)) {
      let stamped = false;
      const content = m.content.map((part: any) => {
        if (stamped || part?.type !== 'text' || typeof part.text !== 'string') return part;
        stamped = true;
        return { ...part, text: stampMessageText(part.text, ts) };
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

function parseSearchQuery(rawArgs: string, fallback: string): string {
  try {
    const args = JSON.parse(rawArgs || '{}');
    const q = String(args?.query || args?.q || '').trim();
    if (q) return q;
  } catch {
    const bare = rawArgs.replace(/^["']|["']$/g, '').trim();
    if (bare) return bare;
  }
  return fallback.slice(0, 200);
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

    const systemParts: string[] = [];
    if (isCursorStyleModel(requestedModel)) {
      systemParts.push(CURSOR_WEB_CHAT_PROMPT);
    }
    systemParts.push(timeContextSystemPrompt(getClockContext()));
    systemParts.push(String(systemPrompt || '').trim() || DEFAULT_SYSTEM_PROMPT);
    if (threadId) {
      systemParts.push(conversationIsolationPrompt(threadId));
    }
    if (searchEnabled) {
      systemParts.push(
        [
          'Live web search may be provided via the web_search tool, or as injected search results in this request.',
          'When search results are present, use them and cite title + URL. Do not pretend to search or invent sources.',
          'Do not claim to read local files, run shell, or scan a workspace.',
          'Relative time in the user question is relative to the Current date/time above.',
        ].join(' '),
      );
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
    const proactiveSearch = searchEnabled && looksLikeSearchRequest(userAsk);

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

        const emitSearch = async (query: string): Promise<SearchOutcome> => {
          const enriched = enrichSearchQuery(query);
          const freshness = freshnessForQuery(query) || freshnessForQuery(enriched);
          send({ tool: { status: 'start', name: 'web_search', query: enriched } });
          const outcome = await webSearch(enriched, { freshness });
          send({
            tool: {
              status: 'done',
              name: 'web_search',
              query: outcome.query,
              provider: outcome.provider,
              results: outcome.results,
              error: outcome.error,
            },
          });
          return outcome;
        };

        try {
          let usedTools = false;

          // 1) Reliable path for agent models / gateways that ignore tools:
          //    run search ourselves when the user clearly asks to look something up.
          if (proactiveSearch) {
            let outcome = await emitSearch(userAsk.slice(0, 240));
            // Chinese “最近/加密” queries often miss on Wikipedia; retry a news-oriented English query.
            if (!outcome.results.length && /加密|币|项目|最近|最新/.test(userAsk)) {
              const clock = getClockContext();
              outcome = await emitSearch(
                englishRecencyQuery(
                  'cryptocurrency crypto funding rounds startups',
                  clock,
                  freshnessForQuery(userAsk) || 'week',
                ),
              );
            }
            if (!outcome.results.length) {
              // Do NOT let the model invent "search results" from training memory.
              const detail = outcome.error || 'All search providers failed';
              send({
                content: [
                  '联网搜索没有返回可用结果，所以我不能编造项目名单或假装查到了资料。',
                  '',
                  `查询：${outcome.query || userAsk}`,
                  `原因：${detail}`,
                  '',
                  '可选下一步：',
                  '1. 在 Vercel 配置 `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` / `SERPER_API_KEY` 后重试',
                  '2. 换一个更具体的英文关键词再问（例如 `new crypto token launches 2026`）',
                  '3. 如果你有链接或新闻标题，直接贴给我，我可以基于你提供的材料分析',
                ].join('\n'),
                finish_reason: 'stop',
              });
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
              return;
            }
            workingMessages.push({
              role: 'system',
              content: [
                'Live web search results (already executed):',
                formatSearchResultsForModel(outcome),
                '',
                'RULES: Answer ONLY from these results. Cite markdown links.',
                'Do NOT invent projects, funding rounds, or URLs not present above.',
                'Do NOT fall back to training-memory lists when results are present.',
                'Treat asOf as today. If a hit is clearly older than the user\'s requested window, label it outdated — do not call it “this week”.',
              ].join('\n'),
            });
            usedTools = true;
          } else if (searchEnabled) {
            // 2) Optional OpenAI-style tool loop (short timeout — cursor gateways often hang).
            for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
              let completion: any;
              try {
                completion = await withTimeout(
                  openai.chat.completions.create({
                    model: requestedModel,
                    temperature,
                    stream: false,
                    messages: workingMessages,
                    tools: [WEB_SEARCH_TOOL],
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
              if (content) send({ content: String(content) });

              if (!toolCalls.length) {
                // Plain answer without tools — finish (avoid a second stream that can hang).
                if (content || reasoning) {
                  send({ finish_reason: choice?.finish_reason || 'stop' });
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  controller.close();
                  return;
                }
                break;
              }

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
                if (tc.name !== 'web_search') {
                  workingMessages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: JSON.stringify({ ok: false, error: `Unknown tool: ${tc.name}` }),
                  });
                  continue;
                }
                const query = parseSearchQuery(tc.arguments, userAsk || content);
                const outcome = await emitSearch(query);
                workingMessages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: formatSearchResultsForModel(outcome),
                });
              }
            }
          }

          const finalMessages = usedTools
            ? [
                ...workingMessages,
                {
                  role: 'user',
                  content:
                    'Using ONLY the search results above, write the final answer now. Cite sources with markdown links. If a claim is not in the results, omit it. Do not invent projects or URLs. Do not call tools. Do not say you are still searching.',
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
