import OpenAI from 'openai';
import { NextRequest } from 'next/server';

export const runtime = 'edge';
export const maxDuration = 60;

function jsonError(message: string, status: number = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Draft a reusable Skill (system prompt) from a short user brief.
 * Bound-account only — same auth boundary as /api/skills.
 */
export async function POST(req: NextRequest) {
  try {
    const boundUserKey = req.cookies.get('llm_chat_api_key')?.value || '';
    if (!boundUserKey) {
      return jsonError('请先连接主站账号', 401);
    }

    const body = await req.json();
    const brief = String(body?.brief || '').trim();
    const model = String(body?.model || 'deepseek-v4-flash-200k').trim();
    if (!brief) return jsonError('请先描述这个 Skill 要做什么', 400);

    const baseURL = (process.env.LLM_CHRISTMAS_BASE_URL || 'https://api.llm.christmas/v1').replace(
      /\/$/,
      '',
    );
    const openai = new OpenAI({ apiKey: boundUserKey, baseURL });

    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content:
            'You write reusable system prompts (Skills) for an AI chat product. ' +
            'Reply with ONLY valid JSON: {"title":"...","content":"..."}. ' +
            'title: short Chinese or English name (≤40 chars). ' +
            'content: a clear system prompt the model will follow every turn — ' +
            'role, tone, language, constraints, output format. No markdown fences.',
        },
        {
          role: 'user',
          content: `Create a Skill from this brief:\n\n${brief}`,
        },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return jsonError('模型未返回有效 Skill JSON', 502);

    let parsed: { title?: string; content?: string };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return jsonError('解析 Skill JSON 失败', 502);
    }

    const title = String(parsed.title || '').trim().slice(0, 80);
    const content = String(parsed.content || '').trim();
    if (!title || !content) return jsonError('生成结果缺少 title 或 content', 502);

    return new Response(JSON.stringify({ success: true, title, content }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('skills generate error:', err);
    const detail = err?.error?.message || err?.message || 'Generate failed';
    return jsonError(detail);
  }
}
