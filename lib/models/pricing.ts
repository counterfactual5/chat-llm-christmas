/**
 * Free/paid classification sourced from the main site's pricing table rather
 * than model-name keywords, so models like `deepseek-v4-flash-200k` that cost
 * nothing are correctly treated as free.
 */

export interface PricingRow {
  model_name: string;
  /** 0 = metered per token (model_ratio), 1 = flat per call (model_price). */
  quota_type?: number;
  model_ratio?: number;
  model_price?: number;
  completion_ratio?: number;
  enable_groups?: string[];
}

const PRICING_TTL_MS = 5 * 60 * 1000;

let cache: { at: number; freeModels: Set<string> } | null = null;

function mainSiteOrigin() {
  const base = process.env.LLM_CHRISTMAS_BASE_URL || 'https://api.llm.christmas/v1';
  return base.replace(/\/v1\/?$/, '').replace(/\/$/, '');
}

export function isRowFree(row: PricingRow): boolean {
  if ((row.quota_type ?? 0) === 1) {
    return Number(row.model_price ?? 0) === 0;
  }
  // Metered models are free only when the prompt ratio is zero; completion
  // ratio is a multiplier on top of it, so it cannot make a zero cost non-zero.
  return Number(row.model_ratio ?? 0) === 0;
}

/**
 * Model names the main site prices at zero. Returns an empty set when pricing
 * is unavailable so callers can fall back instead of locking users out.
 */
export async function fetchFreeModelNames(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < PRICING_TTL_MS) {
    return cache.freeModels;
  }

  try {
    const res = await fetch(`${mainSiteOrigin()}/api/pricing`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`pricing HTTP ${res.status}`);

    const data = await res.json();
    const rows: PricingRow[] = Array.isArray(data?.data) ? data.data : [];
    if (rows.length === 0) throw new Error('empty pricing table');

    const freeModels = new Set(
      rows.filter(isRowFree).map((row) => String(row.model_name).toLowerCase()),
    );
    cache = { at: Date.now(), freeModels };
    return freeModels;
  } catch {
    return cache?.freeModels ?? new Set<string>();
  }
}

/** Keyword fallback used only when the pricing table cannot be reached. */
export function looksFreeByName(modelId: string): boolean {
  return /(^|[-_.])(free|trial|demo)([-_.]|$)/i.test(modelId);
}
