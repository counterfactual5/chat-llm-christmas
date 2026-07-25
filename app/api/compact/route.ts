import OpenAI from 'openai';
import { NextRequest } from 'next/server';
import { fetchFreeModelNames, looksFreeByName } from '@/lib/pricing';

export const runtime = 'edge';
export const maxDuration = 60;

function jsonError(message: string, status: number = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Non-streaming compact: summarize older turns into a condensed context block.
 */
export async function POST(req: NextRequest) {
  try {
    const { messages, model = 'deepseek-v4-flash-200k' } = await req.json();
    const boundUserKey = req.cookies.get('llm_chat_api_key')?.value || '';
    const isBoundAccount = Boolean(boundUserKey);
    const requestedModel = String(model || '').trim();

    if (!isBoundAccount) {
      const freeModels = await fetchFreeModelNames();
      const isFree =
        freeModels.size > 0
          ? freeModels.has(requestedModel.toLowerCase())
          : looksFreeByName(requestedModel);
      if (!isFree) {
        return jsonError('This model requires a connected llm.christmas account.', 403);
      }
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonError('messages must be a non-empty array', 400);
    }

    const apiKey = boundUserKey || process.env.LLM_CHRISTMAS_API_KEY || process.env.OPENAI_API_KEY || '';
    const baseURL = (process.env.LLM_CHRISTMAS_BASE_URL || 'https://api.llm.christmas/v1').replace(/\/$/, '');
    if (!apiKey) return jsonError('Missing API key configuration.', 500);

    const openai = new OpenAI({ apiKey, baseURL });

    const transcript = messages
      .map((m: any) => {
        const role = m.role === 'assistant' ? 'Assistant' : 'User';
        const text =
          typeof m.content === 'string'
            ? m.content
            : Array.isArray(m.content)
              ? m.content
                  .filter((p: any) => p?.type === 'text')
                  .map((p: any) => p.text)
                  .join('\n')
              : '';
        const images = Array.isArray(m.images) ? m.images.length : 0;
        const imageNote = images > 0 ? `\n[${images} image(s) attached]` : '';
        return `${role}:\n${text}${imageNote}`;
      })
      .join('\n\n---\n\n');

    const completion = await openai.chat.completions.create({
      model: requestedModel,
      temperature: 0.2,
      stream: false,
      messages: [
        {
          role: 'system',
          content: `You compress chat history for continued work. Write a dense English or Chinese summary (match the dominant language of the transcript) that preserves:
- User goals and constraints
- Key decisions and conclusions
- Important facts, numbers, paths, code identifiers
- Open questions / unfinished work
Omit greetings, repeated drafts, and filler. Output plain text only — no preamble.`,
        },
        {
          role: 'user',
          content: `Compact the following earlier conversation turns:\n\n${transcript.slice(0, 120_000)}`,
        },
      ],
    } as any);

    const summary = completion?.choices?.[0]?.message?.content?.trim();
    if (!summary) return jsonError('Compact produced an empty summary', 502);

    return new Response(JSON.stringify({ success: true, summary }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    console.error('compact route error:', err);
    const detail = err?.error?.message || err?.message || String(err || 'Compact failed');
    return jsonError(detail);
  }
}
