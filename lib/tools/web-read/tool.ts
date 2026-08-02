import {
  WEB_READ_TOOL,
  formatWebReadForModel,
  webRead,
  type WebReadOutcome,
} from '@/lib/tools/web-read/reader';
import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';

const URL_IN_TEXT = /https?:\/\/[^\s"'`<>)\]}{,]+/gi;
const MD_LINK = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i;

function trimUrlTail(raw: string): string {
  return String(raw || '').replace(/[.,;:!?)\]}'"”』」]+$/g, '');
}

/** Pull a usable URL out of messy model args (markdown, bare host, truncated JSON…). */
function extractUrlCandidate(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';

  const md = s.match(MD_LINK);
  if (md?.[1]) return trimUrlTail(md[1]);

  if (/^https?:\/\//i.test(s)) return trimUrlTail(s);

  // Prefer the first absolute URL embedded anywhere (truncated JSON, "url=…", etc.).
  URL_IN_TEXT.lastIndex = 0;
  const hit = URL_IN_TEXT.exec(s);
  if (hit?.[0]) return trimUrlTail(hit[0]);

  // Bare host/path — webRead.normalizeUrl will add https://
  if (/^(?:www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:[/:?#]\S*)?$/i.test(s)) {
    return s;
  }
  return '';
}

function urlFromArgsObject(args: Record<string, unknown>): string {
  const directKeys = [
    'url',
    'link',
    'href',
    'uri',
    'page_url',
    'pageUrl',
    'target_url',
    'targetUrl',
    'target',
    'query', // free models often reuse the web_search field name
  ];
  for (const key of directKeys) {
    const got = extractUrlCandidate(String(args[key] ?? ''));
    if (got) return got;
  }
  for (const key of ['urls', 'links', 'hrefs']) {
    const arr = args[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const got = extractUrlCandidate(String(item ?? ''));
      if (got) return got;
    }
  }
  return '';
}

export function parseReadUrl(rawArgs: string, fallback: string): string {
  const raw = String(rawArgs || '');

  try {
    const args = JSON.parse(raw || '{}') as Record<string, unknown>;
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      const fromArgs = urlFromArgsObject(args);
      if (fromArgs) return fromArgs;
    }
  } catch {
    // Truncated / non-JSON args are common on free models.
  }

  const fromRaw = extractUrlCandidate(raw);
  if (fromRaw) return fromRaw;

  return extractUrlCandidate(fallback);
}

export async function runWebRead(
  url: string,
  ctx: ToolRuntimeContext,
): Promise<WebReadOutcome> {
  const target = String(url || '').trim();
  ctx.send({
    tool: {
      status: 'start',
      name: 'web_read',
      query: target || '(missing url)',
      provider: 'web',
    },
  });
  const outcome = await webRead(target, {
    apiKey: ctx.credentials?.skillsApiKey,
  });
  // Persist a long extract for later Request review — snippet stays short for UI.
  const PERSIST_BODY_CHARS = 16_000;
  ctx.send({
    tool: {
      status: 'done',
      name: 'web_read',
      query: outcome.url || target || '(missing url)',
      provider: outcome.provider,
      results: outcome.content
        ? [
            {
              title: outcome.title || outcome.url || target,
              url: outcome.url || target,
              snippet: outcome.content.slice(0, 240),
              body: outcome.content.slice(0, PERSIST_BODY_CHARS),
            },
          ]
        : [],
      error: outcome.error,
    },
  });
  return outcome;
}

const WEB_READ_SYSTEM_PROMPT = [
  'You also have a web_read tool to fetch the full text of a specific public URL.',
  'Typical flow: web_search to find links, then web_read on 1–3 promising URLs when snippets are insufficient.',
  'Call web_read when the user pastes a link and asks you to summarize or extract details from that page.',
  'Exception: when GitHub MCP is available this turn, do not use web_read as the primary path for github.com repository, file, directory, issue, pull request, release, or documentation URLs. Use GitHub MCP first; web_read is only a fallback if GitHub MCP cannot access the requested resource.',
  'Always pass an absolute http(s) URL in the `url` field (copy it from web_search results). Do not pass a search query.',
  'Do not invent page contents — only use what web_read returns.',
].join(' ');

export function createWebReadTool(): ChatTool {
  return {
    name: 'web_read',
    definition: WEB_READ_TOOL,
    systemPrompt: WEB_READ_SYSTEM_PROMPT,
    enabled: (flags) => flags.searchEnabled,
    async execute({ rawArguments, fallbackQuery }, ctx) {
      const url = parseReadUrl(rawArguments, fallbackQuery || ctx.userAsk);
      if (!url) {
        const received = String(rawArguments || '').trim().slice(0, 180);
        const outcome: WebReadOutcome = {
          provider: 'none',
          url: '',
          content: '',
          error: received
            ? `Invalid, missing, or blocked URL (received: ${received})`
            : 'Invalid, missing, or blocked URL — pass absolute http(s) url from web_search results',
        };
        ctx.send({
          tool: {
            status: 'done',
            name: 'web_read',
            query: '(missing url)',
            provider: 'web',
            results: [],
            error: outcome.error,
          },
        });
        return {
          content: formatWebReadForModel(outcome),
          data: outcome,
        };
      }
      const outcome = await runWebRead(url, ctx);
      return {
        content: formatWebReadForModel(outcome),
        data: outcome,
      };
    },
  };
}
