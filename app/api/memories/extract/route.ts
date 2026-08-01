import { NextRequest, NextResponse } from 'next/server';
import { completeOnce } from '@/lib/chat/server/upstream';
import { chatBackendMemoriesURL } from '@/lib/chat-backend';
import {
  MEMORY_EXTRACTION_SYSTEM_PROMPT,
  buildMemoryExtractionUserPrompt,
  parseMemoryExtractionResponse,
} from '@/lib/memories/prompt';
import type { MemoryCandidate, MemoryExtractMessage } from '@/lib/memories/types';

export const runtime = 'edge';
export const maxDuration = 60;

const MIN_CONFIDENCE = 0.55;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const boundUserKey = req.cookies.get('llm_chat_api_key')?.value || '';
    if (!boundUserKey) {
      return jsonError('请先连接主站账号', 401);
    }

    const body = (await req.json().catch(() => ({}))) as {
      model?: string;
      conversationId?: string;
      messages?: MemoryExtractMessage[];
      existingMemories?: Array<{ id?: string; kind?: string; content: string }>;
    };

    const model = String(body.model || '').trim();
    if (!model) return jsonError('缺少 model');

    const pending = Array.isArray(body.messages)
      ? body.messages
          .map((m) => ({
            id: m?.id ? String(m.id) : undefined,
            role: m?.role === 'assistant' ? ('assistant' as const) : ('user' as const),
            content: String(m?.content || '').trim(),
          }))
          .filter((m) => m.content)
          .slice(-20)
      : [];
    if (!pending.length) {
      return NextResponse.json({
        success: true,
        data: { candidates: [], saved: [], skipped: 0 },
      });
    }

    const apiKey = boundUserKey;
    const baseURL = (
      process.env.LLM_CHRISTMAS_BASE_URL || 'https://api.llm.christmas/v1'
    ).replace(/\/$/, '');

    const extractionText = await completeOnce({
      apiKey,
      baseURL,
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: MEMORY_EXTRACTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildMemoryExtractionUserPrompt({
            pendingMessages: pending,
            existingMemories: Array.isArray(body.existingMemories)
              ? body.existingMemories.slice(0, 20)
              : [],
          }),
        },
      ],
    });

    const candidates = parseMemoryExtractionResponse(extractionText).filter(
      (c) => (c.confidence == null ? true : c.confidence >= MIN_CONFIDENCE),
    ) as MemoryCandidate[];

    if (!candidates.length) {
      return NextResponse.json({
        success: true,
        data: { candidates: [], saved: [], skipped: 0 },
      });
    }

    const lastMessageId = pending[pending.length - 1]?.id;
    const batchBody = {
      memories: candidates.map((c) => ({
        kind: c.kind,
        content: c.content,
        sourceSessionId: body.conversationId
          ? String(body.conversationId).slice(0, 120)
          : undefined,
        sourceMessageId: lastMessageId,
      })),
    };

    const upstreamRes = await fetch(`${chatBackendMemoriesURL()}/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${boundUserKey}`,
      },
      body: JSON.stringify(batchBody),
      cache: 'no-store',
    });
    const upstream = await upstreamRes.json().catch(() => ({}));
    if (!upstreamRes.ok) {
      return NextResponse.json(
        {
          success: false,
          error: upstream?.error || upstream?.message || '保存记忆失败',
          candidates,
        },
        { status: upstreamRes.status },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        candidates,
        saved: upstream?.data?.saved || [],
        skipped: Number(upstream?.data?.skipped || 0),
      },
    });
  } catch (error: any) {
    console.error('[memories/extract]', error);
    return jsonError(error?.message || '记忆抽取失败', 502);
  }
}
