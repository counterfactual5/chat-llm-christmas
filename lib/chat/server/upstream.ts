/**
 * Upstream llm.christmas / OpenAI-compatible chat.completions transport.
 * Streaming SSE + one-shot verifier completions — reusable by other API routes.
 */

import { withIncludeUsage } from '@/lib/chat/stream/usage';

/**
 * Raw SSE chat.completions — preserves gateway-only fields like reasoning_content
 * that the OpenAI SDK types omit (runtime usually keeps them, but this is explicit).
 * If the gateway rejects enable_thinking or stream_options, retry once without them.
 */
export async function* streamChatCompletionsRaw(opts: {
  apiKey: string;
  baseURL: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  /** Request usage on the final SSE chunk when the gateway supports it. */
  includeUsage?: boolean;
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

  let body: Record<string, unknown> = opts.includeUsage
    ? withIncludeUsage({ ...opts.body })
    : { ...opts.body };
  let res = await post(body);
  if (!res.ok) {
    let errText = await res.text().catch(() => '');
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
      if (!res.ok) errText = await res.text().catch(() => errText);
    }
    const unsupportedStreamOptions =
      Boolean(body.stream_options) &&
      res.status === 400 &&
      /stream_options/i.test(errText);
    if (!res.ok && unsupportedStreamOptions) {
      const { stream_options: _drop, ...rest } = body;
      body = rest;
      console.warn(
        'upstream rejected stream_options; retrying without it',
        body.model,
      );
      res = await post(body);
      if (!res.ok) errText = await res.text().catch(() => errText);
    }
    if (!res.ok) {
      throw new Error(
        `Upstream chat error: ${res.status} ${(errText || res.statusText).slice(0, 300)}`,
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
 *
 * Gateways often mirror the same thinking tokens onto several fields in one
 * chunk (`reasoning_content` + `reasoning`, etc.). Concatenating them produces
 * stutter like "TheThe user wants…". Prefer the first non-empty channel.
 */
export function splitCompletionDelta(
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

  if (!reasoning) {
    for (const key of [
      'reasoning_content',
      'reasoning',
      'thinking',
      'thinking_content',
    ] as const) {
      const text = String(delta?.[key] || '');
      if (text) {
        reasoning = text;
        break;
      }
    }
  }

  if (opts.reasoningAsContent && reasoning) {
    content += reasoning;
    reasoning = '';
  }
  return { content, reasoning };
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
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
export async function completeOnce(opts: {
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
