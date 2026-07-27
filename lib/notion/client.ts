/**
 * Minimal Notion REST helpers for chat tools.
 * Uses the user's OAuth access token — never a shared workspace secret.
 */

export const NOTION_VERSION = '2022-06-28';

export type NotionSearchHit = {
  id: string;
  object: string;
  title: string;
  url: string;
  lastEditedTime?: string;
};

function notionHeaders(token: string, json = false): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
  };
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function richTextPlain(rich: unknown): string {
  if (!Array.isArray(rich)) return '';
  return rich
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const p = part as { plain_text?: string };
      return String(p.plain_text || '');
    })
    .join('');
}

export function extractNotionTitle(item: Record<string, unknown>): string {
  if (item.object === 'database' && Array.isArray(item.title)) {
    const t = richTextPlain(item.title).trim();
    if (t) return t;
  }
  const props = item.properties;
  if (props && typeof props === 'object') {
    for (const value of Object.values(props as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const prop = value as { type?: string; title?: unknown; name?: unknown };
      if (prop.type === 'title') {
        const t = richTextPlain(prop.title).trim();
        if (t) return t;
      }
      if (prop.type === 'name') {
        const t = richTextPlain(prop.name).trim();
        if (t) return t;
      }
    }
  }
  return 'Untitled';
}

function blockPlainText(block: Record<string, unknown>): string {
  const type = String(block.type || '');
  const body = block[type];
  if (!body || typeof body !== 'object') return '';
  const data = body as Record<string, unknown>;
  if (Array.isArray(data.rich_text)) return richTextPlain(data.rich_text);
  if (Array.isArray(data.text)) return richTextPlain(data.text);
  if (Array.isArray(data.caption)) return richTextPlain(data.caption);
  if (typeof data.expression === 'string') return data.expression;
  if (type === 'child_page' || type === 'child_database') {
    return String(data.title || '').trim();
  }
  if (type === 'bookmark' || type === 'embed' || type === 'link_preview') {
    return String(data.url || '').trim();
  }
  if (type === 'code') {
    return richTextPlain(data.rich_text);
  }
  return '';
}

export async function notionApi<T = unknown>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T; error?: string }> {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      ...notionHeaders(token, Boolean(init?.body)),
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    code?: string;
  };
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data,
      error: String(
        (data as { message?: string }).message ||
          (data as { code?: string }).code ||
          `Notion API ${response.status}`,
      ),
    };
  }
  return { ok: true, status: response.status, data };
}

export async function notionSearch(
  token: string,
  query: string,
  opts?: { pageSize?: number; filter?: 'page' | 'database' },
): Promise<{ ok: boolean; results: NotionSearchHit[]; error?: string }> {
  const body: Record<string, unknown> = {
    query: query.slice(0, 200),
    page_size: Math.min(Math.max(opts?.pageSize ?? 10, 1), 25),
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
  };
  if (opts?.filter) {
    body.filter = { property: 'object', value: opts.filter };
  }

  const res = await notionApi<{ results?: Array<Record<string, unknown>> }>(
    token,
    '/search',
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (!res.ok) return { ok: false, results: [], error: res.error };

  const results: NotionSearchHit[] = (res.data.results || []).map((item) => ({
    id: String(item.id || ''),
    object: String(item.object || 'page'),
    title: extractNotionTitle(item),
    url: String(item.url || ''),
    lastEditedTime: item.last_edited_time
      ? String(item.last_edited_time)
      : undefined,
  }));

  return { ok: true, results };
}

/** Flatten page/block children into readable text (shallow + one nested level). */
export async function notionFetchPageContent(
  token: string,
  pageId: string,
): Promise<{
  ok: boolean;
  id: string;
  title: string;
  url: string;
  text: string;
  error?: string;
}> {
  const id = pageId.replace(/-/g, '').length === 32
    ? pageId
    : pageId.trim();

  const pageRes = await notionApi<Record<string, unknown>>(token, `/pages/${id}`);
  if (!pageRes.ok) {
    return {
      ok: false,
      id,
      title: '',
      url: '',
      text: '',
      error: pageRes.error,
    };
  }

  const title = extractNotionTitle(pageRes.data);
  const url = String(pageRes.data.url || '');
  const lines: string[] = [];

  const loadChildren = async (blockId: string, depth: number) => {
    if (depth > 2) return;
    let cursor: string | undefined;
    let pages = 0;
    do {
      const qs = new URLSearchParams({ page_size: '50' });
      if (cursor) qs.set('start_cursor', cursor);
      const children = await notionApi<{
        results?: Array<Record<string, unknown>>;
        next_cursor?: string | null;
        has_more?: boolean;
      }>(token, `/blocks/${blockId}/children?${qs.toString()}`);
      if (!children.ok) {
        if (depth === 0 && lines.length === 0) {
          throw new Error(children.error || 'Failed to read page blocks');
        }
        break;
      }
      for (const block of children.data.results || []) {
        const type = String(block.type || '');
        const text = blockPlainText(block).trim();
        if (text) {
          const prefix =
            type === 'heading_1'
              ? '# '
              : type === 'heading_2'
                ? '## '
                : type === 'heading_3'
                  ? '### '
                  : type === 'bulleted_list_item'
                    ? '- '
                    : type === 'numbered_list_item'
                      ? '1. '
                      : type === 'to_do'
                        ? '- [ ] '
                        : type === 'quote'
                          ? '> '
                          : type === 'code'
                            ? '```\n'
                            : '';
          const suffix = type === 'code' ? '\n```' : '';
          lines.push(`${prefix}${text}${suffix}`);
        } else if (type === 'divider') {
          lines.push('---');
        }
        if (block.has_children && depth < 2) {
          await loadChildren(String(block.id), depth + 1);
        }
        if (lines.join('\n').length > 12_000) return;
      }
      cursor = children.data.has_more
        ? children.data.next_cursor || undefined
        : undefined;
      pages += 1;
    } while (cursor && pages < 4);
  };

  try {
    await loadChildren(String(pageRes.data.id || id), 0);
  } catch (err) {
    return {
      ok: false,
      id: String(pageRes.data.id || id),
      title,
      url,
      text: '',
      error: err instanceof Error ? err.message : 'Failed to read page content',
    };
  }

  let text = lines.join('\n').trim();
  if (text.length > 12_000) {
    text = `${text.slice(0, 12_000)}\n\n…(truncated)`;
  }

  return {
    ok: true,
    id: String(pageRes.data.id || id),
    title,
    url,
    text: text || '(This page has no readable text blocks shared with the integration.)',
  };
}

/** Append paragraph blocks to the end of a page (insert/update capability). */
export async function notionAppendParagraphs(
  token: string,
  pageId: string,
  paragraphs: string[],
): Promise<{ ok: boolean; id: string; url?: string; appended: number; error?: string }> {
  const id = pageId.trim();
  const children = paragraphs
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((text) => ({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: { content: text.slice(0, 2000) },
          },
        ],
      },
    }));

  if (children.length === 0) {
    return { ok: false, id, appended: 0, error: 'No paragraph text to append' };
  }

  const res = await notionApi<{ results?: unknown[] }>(
    token,
    `/blocks/${id}/children`,
    {
      method: 'PATCH',
      body: JSON.stringify({ children }),
    },
  );

  if (!res.ok) {
    return { ok: false, id, appended: 0, error: res.error };
  }

  // Best-effort URL for UI chips
  const page = await notionApi<Record<string, unknown>>(token, `/pages/${id}`);
  return {
    ok: true,
    id,
    url: page.ok ? String(page.data.url || '') : undefined,
    appended: children.length,
  };
}
