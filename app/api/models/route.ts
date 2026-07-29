import { NextRequest } from 'next/server';
import { fetchFreeModelNames, looksFreeByName } from '@/lib/pricing';
import { getModelSpec, isChatPickerModel } from '@/lib/model-specs';

export const runtime = 'edge';
export const maxDuration = 30;

/** Shared catalog (site key). Same list for every visitor; filter free/paid per request. */
const CATALOG_TTL_MS = 2 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 12_000;

type CatalogModel = {
  id: string;
  owned_by: string;
  group: string;
  tags: unknown[];
  tier: 'free' | 'paid';
  context_window: number | null;
  max_output: number | null;
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
  return new Response(JSON.stringify({ error: message, success: false, models: [] }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function fetchUpstreamModels(
  baseURL: string,
  apiKey: string,
): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`${baseURL}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Upstream models error: ${res.status} ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  return Array.isArray(data?.data) ? data.data : [];
}

async function buildCatalog(
  list: Array<Record<string, unknown>>,
): Promise<CatalogModel[]> {
  const freeModels = await fetchFreeModelNames();
  return list.map((m) => {
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
}

async function loadSharedCatalog(baseURL: string, siteApiKey: string): Promise<CatalogModel[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.models;
  }
  if (catalogInflight) return catalogInflight;

  catalogInflight = (async () => {
    const list = await fetchUpstreamModels(baseURL, siteApiKey);
    const models = await buildCatalog(list);
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

  if (!siteApiKey && !boundUserKey) {
    return jsonError('Missing API key configuration.', 500);
  }

  const showAll = Boolean(boundUserKey);

  try {
    let all: CatalogModel[];

    // Prefer shared site catalog when available (same list for everyone).
    // If site key is missing/fails/times out and the user is bound, fall back to their key.
    if (siteApiKey) {
      try {
        all = await loadSharedCatalog(baseURL, siteApiKey);
      } catch (siteErr) {
        if (!boundUserKey) throw siteErr;
        const list = await fetchUpstreamModels(baseURL, boundUserKey);
        all = await buildCatalog(list);
      }
    } else {
      const list = await fetchUpstreamModels(baseURL, boundUserKey);
      all = await buildCatalog(list);
    }

    const chatModels = all.filter((m) => isChatPickerModel(m.id));
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
    const timedOut =
      (err instanceof Error && err.name === 'TimeoutError') ||
      /aborted|timeout/i.test(message);
    const statusMatch = message.match(/Upstream models error: (\d+)/);
    const status = timedOut ? 504 : statusMatch ? Number(statusMatch[1]) : 500;
    return jsonError(
      timedOut ? 'Model list timed out. Please retry.' : message,
      status >= 400 && status < 600 ? status : 500,
    );
  }
}
