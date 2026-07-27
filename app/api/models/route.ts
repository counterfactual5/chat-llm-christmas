import { NextRequest } from 'next/server';
import { fetchFreeModelNames, looksFreeByName } from '@/lib/pricing';
import { getModelSpec, isImageGenerationModel } from '@/lib/model-specs';

export const runtime = 'edge';
export const maxDuration = 30;

/**
 * Shared catalog for all visitors. Upstream model lists and pricing are the
 * same site-wide; per-request we only filter guest (free) vs bound (all chat).
 */
const CATALOG_TTL_MS = 2 * 60 * 1000;

type CatalogModel = {
  id: string;
  owned_by: string;
  group: string;
  tags: unknown[];
  tier: 'free' | 'paid';
  context_window: number;
  max_output: number;
  vision: boolean;
};

let catalogCache: { at: number; models: CatalogModel[] } | null = null;
let catalogInflight: Promise<CatalogModel[]> | null = null;

function classifyModel(model: { id?: string }, freeModels: Set<string>): 'free' | 'paid' {
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

async function loadSharedCatalog(baseURL: string, siteApiKey: string): Promise<CatalogModel[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.models;
  }
  if (catalogInflight) return catalogInflight;

  catalogInflight = (async () => {
    const res = await fetch(`${baseURL}/models`, {
      headers: {
        Authorization: `Bearer ${siteApiKey}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Upstream models error: ${res.status} ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const list = Array.isArray(data?.data) ? data.data : [];
    const freeModels = await fetchFreeModelNames();

    const models: CatalogModel[] = list.map((m: Record<string, unknown>) => {
      const id = String(m.id || '');
      const spec = getModelSpec(id);
      return {
        id,
        owned_by: String(m.owned_by || 'unknown'),
        group: String(m.group || 'default'),
        tags: Array.isArray(m.tags) ? m.tags : [],
        tier: classifyModel({ id }, freeModels),
        context_window: spec.context,
        max_output: spec.maxOutput,
        vision: spec.vision,
      };
    });

    catalogCache = { at: Date.now(), models };
    return models;
  })().finally(() => {
    catalogInflight = null;
  });

  return catalogInflight;
}

export async function GET(req: NextRequest) {
  const boundUserKey = req.cookies.get('llm_chat_api_key')?.value || '';
  const siteApiKey = process.env.LLM_CHRISTMAS_API_KEY || process.env.OPENAI_API_KEY || '';
  const baseURL = (process.env.LLM_CHRISTMAS_BASE_URL || 'https://api.llm.christmas/v1').replace(
    /\/$/,
    '',
  );

  // Shared catalog always uses the site key so every visitor hits one cache.
  // Bound users still get the full chat list; guests only see free models.
  const catalogKey = siteApiKey || boundUserKey;
  if (!catalogKey) {
    return jsonError('Missing API key configuration.', 500);
  }

  try {
    const all = await loadSharedCatalog(baseURL, catalogKey);
    const showAll = Boolean(boundUserKey);
    const chatModels = all.filter((m) => !isImageGenerationModel(m.id));
    const visible = showAll ? chatModels : chatModels.filter((m) => m.tier === 'free');

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
          'Cache-Control': 'private, max-age=30',
        },
      },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err || 'Failed to fetch models');
    const statusMatch = message.match(/Upstream models error: (\d+)/);
    const status = statusMatch ? Number(statusMatch[1]) : 500;
    return jsonError(message, status >= 400 && status < 600 ? status : 500);
  }
}
