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

async function* chunkText(text: string) {
  const chunkSize = 8;
  for (let i = 0; i < text.length; i += chunkSize) {
    yield text.slice(i, i + chunkSize);
  }
}

async function* aiSdkV3TextStream(generator: AsyncGenerator<string>) {
  const encoder = new TextEncoder();
  async function* start() {
    for await (const chunk of generator) {
      const content = chunk;
      if (content) {
        yield encoder.encode(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }
    yield encoder.encode('data: [DONE]\n\n');
  }
  yield* start();
}

export async function POST(req: NextRequest) {
  try {
    const { messages, model = 'deepseek-v4-flash-200k' } = await req.json();
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
      stream: true,
      messages: baseMessages,
    } as any);

    return new Response(aiSdkV3TextStream(toCleanTextStream(response as any)), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Vercel-AI-Data-Stream': 'v1',
      },
    });
  } catch (err: any) {
    console.error('chat route error:', err);
    const status = err?.status || err?.statusCode || err?.response?.status;
    const detail = err?.error?.message || err?.message || String(err || 'Upstream model request failed.');
    return jsonError(`${detail}${status ? ` (HTTP ${status})` : ''}`);
  }
}

async function* toCleanTextStream(response: any) {
  for await (const chunk of response) {
    const content = chunk?.choices?.[0]?.delta?.content || '';
    if (content) {
      yield content;
    }
  }
}