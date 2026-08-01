/**
 * Chat message prep for the upstream completions API:
 * timestamps, schema sanitize, tool_call extraction, and search-intent heuristics.
 */

import { stampMessageText, stripMessageStamp } from '@/lib/chat/context/time-context';

/** Heuristic: user clearly wants a live lookup (used for cursor-* proactive search). */
export function looksLikeSearchRequest(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  return /查一下|帮我查|搜一下|搜索|查找|找一下|最近.*项目|最新|新闻|行情|融资|目前|现在怎么样|现在怎样|如何了|价格|价位|走势|涨跌|多少钱|price|search|look\s*up|find\s+(me\s+)?(the\s+)?(latest|recent)|what.*(happening|new)|how\s+is\s+|google/i.test(
    t,
  );
}

/** Cursor often narrates “I'll search…” instead of emitting tool_calls. */
export function narratesSearchInsteadOfCalling(text: string): boolean {
  const t = String(text || '');
  // Meta / retract talk is not a pending search.
  if (
    /(不(用|需要|该|必|再)(去)?(搜索|联网|搜)|基础知识|知识库|为什么(还)?要(搜索|搜)|认知校准)/i.test(
      t,
    )
  ) {
    return false;
  }
  // Bare「查」is ambiguous — require clear web-search wording.
  return /先.{0,8}(联网|上网)?(搜索|搜一下)|正在(联网|上网)?搜索|让我(去)?(联网|上网)?(搜索|搜一下)|我来(联网|上网)?(搜索|搜一下)|联网查一下|上网查一下|I'll (go )?(and )?search|let me search|searching (the )?(web|internet)|look\s*up (online|on the web)/i.test(
    t,
  );
}

export function extractToolCalls(message: any): Array<{
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

export function lastUserText(messages: any[]): string {
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

export function parseTimestampMs(value: unknown): number | null {
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
export function withMessageTimestamps(messages: any[]): any[] {
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
 * Whether the latest user message already carries vision `image_url` parts
 * (used when deciding mid-turn image_understand / vision paths).
 */
export function lastUserMessageHasImageParts(messages: any[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    if (!Array.isArray(m?.content)) return false;
    return m.content.some((p: any) => p?.type === 'image_url');
  }
  return false;
}

/**
 * OpenAI-compatible gateways (incl. some GLM routes) reject unknown message
 * fields like `timestamp` / `images`. Keep only chat-completion schema keys.
 */
export function sanitizeChatMessages(messages: any[]): any[] {
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
