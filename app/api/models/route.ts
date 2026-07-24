import { NextRequest } from 'next/server';

export const runtime = 'edge';
export const maxDuration = 30;

// 常见免/付费分组标签
const FREE_GROUP_KEYWORDS = ['free', 'trial', 'demo'];
const PAID_GROUP_KEYWORDS = ['pro', 'paid', 'plus', 'premium', 'vip'];

function classifyModel(model: any) {
  // 新API/one-api 类型系统里，model.id 是 'gpt-4o'，model.group 是分组
  // 兜底：没有 group 时，id 中包含 'free' 也算免费
  const id = String(model?.id || '').toLowerCase();
  const group = String(model?.group || '').toLowerCase();
  const tags = (model?.tags || []).map((t: string) => String(t).toLowerCase());

  const haystack = [id, group, ...tags].join(' ');

  if (FREE_GROUP_KEYWORDS.some(k => haystack.includes(k))) {
    return 'free';
  }
  return 'paid';
}

function jsonError(message: string, status: number = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const userBearerKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  // 优先用用户自己的 key，没有就用站点 key 来拉取清单
  const apiKey = userBearerKey || process.env.LLM_CHRISTMAS_API_KEY || process.env.OPENAI_API_KEY || '';
  const baseURL = (process.env.LLM_CHRISTMAS_BASE_URL || 'https://api.llm.christmas/v1').replace(/\/$/, '');

  if (!apiKey) {
    return jsonError('Missing API key configuration.', 500);
  }

  try {
    // 标准 OpenAI / one-api 协议
    const res = await fetch(`${baseURL}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      // 防止 Edge 缓存
      cache: 'no-store',
    });

    if (!res.ok) {
      const errText = await res.text();
      return jsonError(`Upstream models error: ${res.status} ${errText.slice(0, 200)}`, res.status);
    }

    const data = await res.json();
    const list = Array.isArray(data?.data) ? data.data : [];

    // 转换为前端友好结构，并做免费/付费分类
    const all = list.map((m: any) => ({
      id: m.id,
      owned_by: m.owned_by || 'unknown',
      group: m.group || 'default',
      tags: m.tags || [],
      tier: classifyModel(m),
    }));

    // 仅当用户带了 Bearer key 时才返回付费模型
    const showAll = Boolean(userBearerKey);
    const visible = showAll ? all : all.filter((m: any) => m.tier === 'free');

    return new Response(
      JSON.stringify({
        success: true,
        authed: showAll,
        total: all.length,
        visible_count: visible.length,
        models: visible,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (err: any) {
    return jsonError(`Failed to fetch models: ${err?.message || String(err)}`, 500);
  }
}