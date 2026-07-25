import { NextRequest } from 'next/server';
import { fetchFreeModelNames, looksFreeByName } from '@/lib/pricing';
import { getModelSpec, isImageGenerationModel } from '@/lib/model-specs';

export const runtime = 'edge';
export const maxDuration = 30;

/**
 * A model is free when the main site prices it at zero. Names are only used as
 * a fallback if the pricing table is unreachable.
 */
function classifyModel(model: any, freeModels: Set<string>) {
  const id = String(model?.id || '');
  if (freeModels.size > 0) {
    return freeModels.has(id.toLowerCase()) ? 'free' : 'paid';
  }
  return looksFreeByName(id) ? 'free' : 'paid';
}

function jsonError(message: string, status: number = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET(req: NextRequest) {
  const boundUserKey = req.cookies.get('llm_chat_api_key')?.value || '';

  // 优先使用仅服务端可读的绑定 Key；游客使用站点免费 Key。
  const apiKey = boundUserKey || process.env.LLM_CHRISTMAS_API_KEY || process.env.OPENAI_API_KEY || '';
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

    const freeModels = await fetchFreeModelNames();

    // 转换为前端友好结构，并按主站定价 + 能力表做分类
    const all = list.map((m: any) => {
      const spec = getModelSpec(String(m.id || ''));
      return {
        id: m.id,
        owned_by: m.owned_by || 'unknown',
        group: m.group || 'default',
        tags: m.tags || [],
        tier: classifyModel(m, freeModels),
        context_window: spec.context,
        max_output: spec.maxOutput,
        vision: spec.vision,
      };
    });

    // 绑定个人 Key 后返回该 Key 可访问的全量模型；游客仅显示免费模型。
    // Image-only models (gpt-image-*, dall-e, …) stay out of chat — use /image.
    const showAll = Boolean(boundUserKey);
    const chatModels = all.filter((m: any) => !isImageGenerationModel(m.id));
    const visible = showAll ? chatModels : chatModels.filter((m: any) => m.tier === 'free');

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