import OpenAI from 'openai';
import { NextRequest } from 'next/server';

export const runtime = 'edge';
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are a helpful AI assistant. Answer the user's questions clearly and concisely. If you're unsure about something, say so rather than making up information.`;

function jsonError(message: string, status: number = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req: NextRequest) {
  try {
    const { messages, model = 'deepseek-v4-flash-200k', temperature = 0.7 } = await req.json();
    const apiKey = process.env.LLM_CHRISTMAS_API_KEY || process.env.OPENAI_API_KEY || '';
    const baseURL = (process.env.LLM_CHRISTMAS_BASE_URL || 'https://api.llm.christmas/v1').replace(/\/$/, '');

    if (!apiKey) {
      return jsonError('Missing LLM_CHRISTMAS_API_KEY in Vercel environment variables.', 500);
    }
    if (!Array.isArray(messages)) {
      return jsonError('Invalid request: messages must be an array.', 400);
    }

    const openai = new OpenAI({ apiKey, baseURL });
    const baseMessages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];

    const response = await openai.chat.completions.create({
      model,
      temperature,
      stream: true,
      messages: baseMessages,
    } as any);

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of response as any) {
            const content = chunk?.choices?.[0]?.delta?.content || '';
            if (content) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
              );
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (err: any) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Vercel-AI-Data-Stream': 'v1',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err: any) {
    console.error('chat route error:', err);
    const status = err?.status || err?.statusCode || err?.response?.status;
    const detail = err?.error?.message || err?.message || String(err || 'Upstream model request failed.');
    return jsonError(`${detail}${status ? ` (HTTP ${status})` : ''}`);
  }
}