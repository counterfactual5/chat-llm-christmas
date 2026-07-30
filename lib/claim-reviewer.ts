/**
 * Claim Reviewer — single layer that catches narrated tool successes without
 * real tool_calls (mid-turn correction + post-audit). Product capability, not
 * MCP, not a model-callable tool.
 */

export type FakedToolSurface =
  | 'notion'
  | 'github'
  | 'gmail'
  | 'calendar'
  | 'drive'
  | 'web_search'
  | 'web_read'
  | 'save_skill';

export const REVIEWER_SYSTEM_PROMPT = [
  '【Claim Reviewer — 硬性约束】',
  '任何「已创建/已更新/已发送/根据搜索/已保存」类声明，必须对应本轮真实 tool_calls 的成功回执。',
  '任何「先读一下/Let me fetch/我来搜索」类意图，必须立刻发出真实 tool_calls，禁止只口头说要做却结束本轮。',
  '只口头叙述而没有 tool_calls = 失败，必须立即发出真实 tool_calls，或明确撤回并禁止编造 notion.so / github.com / google.com 等链接。',
].join('');

/** Detect narrated successes scoped to enabled surfaces. */
export function detectFakedToolNarration(
  text: string,
  opts: { searchEnabled: boolean; integrations: string[]; skillCreator?: boolean },
): FakedToolSurface[] {
  const t = String(text || '');
  if (!t.trim()) return [];
  const set = new Set(
    (opts.integrations || []).map((id) => String(id || '').trim().toLowerCase()),
  );
  const found: FakedToolSurface[] = [];

  if (set.has('notion')) {
    const hasNotionUrl = /(app\.notion\.com|notion\.so|notion\.site)\//i.test(t);
    const claimsWrite =
      /(正在(更新|写入|创建)|已(经)?(更新|写入|创建|改好|重构)|更新页面|写入.*页面|按你的要求重构|创建了?(这个|一个)?(页面|模板))/i.test(
        t,
      ) || /(updated|created|wrote|writing)\s+(the\s+)?(notion\s+)?page/i.test(t);
    if (claimsWrite && (hasNotionUrl || /notion|页面|模板/i.test(t))) found.push('notion');
  }

  if (set.has('github')) {
    const hasGhUrl = /github\.com\//i.test(t);
    const claimsWrite =
      /(创建|提交|打开|评论).{0,12}(issue|PR|pull request|拉取请求)|已(创建|提交|评论|打开).{0,12}(issue|PR)|created (an? )?(issue|PR|pull request)|opened (an? )?(PR|pull request)|commented on/i.test(
        t,
      );
    if (claimsWrite || (hasGhUrl && /(创建|提交|issue|PR|pull request)/i.test(t))) found.push('github');
  }

  if (set.has('gmail')) {
    if (
      /(已(经)?(发送|回复|转发)|正在发送).{0,8}(邮件|邮箱|gmail)|sent (the )?(email|mail)|replied to/i.test(t) ||
      (/mail\.google\.com|gmail/i.test(t) && /(发送|回复|sent|reply)/i.test(t))
    ) {
      found.push('gmail');
    }
  }

  if (set.has('calendar')) {
    if (
      /(已(经)?(创建|添加|安排)|正在(创建|添加)).{0,10}(日程|日历|会议|event)|created (a )?(calendar )?event|scheduled/i.test(t) ||
      (/calendar\.google\.com/i.test(t) && /(创建|日程|event|scheduled)/i.test(t))
    ) {
      found.push('calendar');
    }
  }

  if (set.has('drive')) {
    if (
      /(已(经)?(上传|创建|分享)|正在(上传|创建)).{0,10}(文件|文档|Drive|网盘)|uploaded (a )?file|created (a )?doc/i.test(t) ||
      (/drive\.google\.com/i.test(t) && /(上传|创建|分享|upload)/i.test(t))
    ) {
      found.push('drive');
    }
  }

  if (opts.searchEnabled) {
    if (
      /(根据(联网)?搜索|搜索(结果|显示|表明)|查到了|检索到)|according to (my |the )?(web )?search|I found the following links/i.test(t) &&
      /https?:\/\//i.test(t)
    ) {
      found.push('web_search');
    }
    if (
      /(我(已经|已)?读完|根据(该|此)页|页面内容显示)|I (have )?read (the )?(page|article)|according to the page/i.test(t) &&
      /https?:\/\//i.test(t)
    ) {
      found.push('web_read');
    }
  }

  if (opts.skillCreator) {
    if (
      /(已(经)?(保存|存入)|保存成功|skill 已(经)?保存|saved (the )?skill)/i.test(t) &&
      /skill/i.test(t)
    ) {
      found.push('save_skill');
    }
  }

  return found;
}

/**
 * Detect “I'll fetch/read/update first…” narration with no tool_calls.
 * Different from success-claims: the model announces intent then stops.
 */
export function detectPendingToolIntent(
  text: string,
  opts: { searchEnabled: boolean; integrations: string[] },
): FakedToolSurface[] {
  const t = String(text || '');
  if (!t.trim()) return [];
  const set = new Set(
    (opts.integrations || []).map((id) => String(id || '').trim().toLowerCase()),
  );
  const found: FakedToolSurface[] = [];

  if (set.has('notion')) {
    const intendsNotion =
      /(先(读|看|获取|拉取|打开)|让我(先)?(读|看|获取|拉取)|我(先|来)(读|看|获取).{0,16}(页面|内容|Notion)|读一下(当前)?(页面|内容)|看一下(当前)?页面|fetch (the )?(current )?(page|content)|let me (first )?(fetch|read|get|load)|I('ll| will) (first )?(fetch|read|get)|正在(读取|获取|拉取).{0,12}(页面|内容|Notion)|然后重写|then (rewrite|update)|重写——|重写—)/i.test(
        t,
      );
    if (intendsNotion) found.push('notion');
  }

  if (opts.searchEnabled) {
    if (
      /(先.{0,10}(查|搜)|让我(去)?(查|搜)|我来(查|搜)|I'll (go )?(and )?(search|look\s*up)|let me (search|look\s*up)|searching (the )?(web|internet))/i.test(
        t,
      )
    ) {
      found.push('web_search');
    }
    if (
      /(先(读|打开).{0,10}(链接|网页|文章)|let me (read|open) (the )?(page|link|article)|I'll (read|open) (the )?(page|link))/i.test(
        t,
      )
    ) {
      found.push('web_read');
    }
  }

  if (set.has('github')) {
    if (
      /(先(看|读|获取).{0,12}(仓库|repo|issue|PR)|let me (check|fetch|read).{0,12}(repo|issue|PR|pull))/i.test(
        t,
      )
    ) {
      found.push('github');
    }
  }

  return found;
}

const SURFACE_LABELS: Record<FakedToolSurface, string> = {
  notion: 'Notion write',
  github: 'GitHub write',
  gmail: 'Gmail send/reply',
  calendar: 'Google Calendar write',
  drive: 'Google Drive write',
  web_search: 'web_search',
  web_read: 'web_read',
  save_skill: 'save_skill',
};

const INTENT_LABELS: Record<FakedToolSurface, string> = {
  notion: 'Notion fetch/update',
  github: 'GitHub read/write',
  gmail: 'Gmail',
  calendar: 'Google Calendar',
  drive: 'Google Drive',
  web_search: 'web_search',
  web_read: 'web_read',
  save_skill: 'save_skill',
};

export function buildCorrectionPrompt(surfaces: FakedToolSurface[]): string {
  const list = surfaces.map((s) => SURFACE_LABELS[s]).join(', ');
  return [
    `You claimed a successful tool action (${list}) in the message above, but you did not emit any tool_calls in THIS turn.`,
    'Do one of the following now via real API tool_calls: call the appropriate tool(s) with real arguments from prior results,',
    'OR clearly retract the claim and say the action was NOT performed — do not invent notion.so / github.com / google.com result links or fake tool payloads.',
  ].join(' ');
}

export function buildPendingIntentPrompt(surfaces: FakedToolSurface[]): string {
  const list = surfaces.map((s) => INTENT_LABELS[s]).join(', ');
  return [
    `You announced you would use tools (${list}) but you did not emit any tool_calls in THIS turn — the reply stopped after the announcement.`,
    'Stop narrating. Immediately emit real API tool_calls now.',
    'For Notion: call notion-fetch or notion-search first to get page_id, then notion-update-page with top-level page_id if writing.',
    'Do not claim you already read or updated anything until tools return success.',
  ].join(' ');
}

export type ReviewerPhase = 'mid' | 'audit' | 'requested';

export type ReviewFindingVerdict =
  | 'pending_intent'
  | 'unsupported'
  | 'tool_failed'
  | 'no_receipt';

export type ReviewFinding = {
  id: string;
  severity: 'error' | 'warn';
  surface: FakedToolSurface;
  verdict: ReviewFindingVerdict;
  claim: string;
  evidence: string;
};

/** A single retrieval hit the tools actually returned — basis for citation checks. */
export type ExecutionSource = {
  url: string;
  title?: string;
  snippet?: string;
};

export type ExecutionRecordEntry = {
  tool: string;
  provider?: string;
  ok: boolean;
  error?: string;
  query?: string;
  /** URLs the tool actually returned — basis for citation alignment. */
  urls?: string[];
  /** Richer hits (title/snippet) when the tool payload carries them. */
  sources?: ExecutionSource[];
};

type ClientToolRun = {
  name: string;
  status: string;
  query?: string;
  error?: string;
  provider?: string;
  results?: Array<{ url?: string; title?: string; snippet?: string }>;
};

type ChatMessageLike = {
  role?: string;
  content?: unknown;
  tool_call_id?: string;
  tool_calls?: Array<{ id?: string; function?: { name?: string } }>;
};

const SURFACE_TOOL_PATTERNS: Record<FakedToolSurface, RegExp[]> = {
  notion: [/notion[-_](update|create|append|delete|move|duplicate|comment)/i, /^notion-update/i],
  github: [/github[-_]create/i, /github[-_]comment/i, /github[-_]open/i],
  gmail: [/gmail[-_]send/i, /gmail[-_]reply/i, /gmail[-_]forward/i],
  calendar: [/calendar[-_]create/i, /calendar[-_]insert/i, /calendar[-_]update/i],
  drive: [/drive[-_]upload/i, /drive[-_]create/i, /drive[-_]share/i],
  web_search: [/web_search/i, /proactive_search/i],
  web_read: [/web_read/i, /web-read/i, /read_url/i],
  save_skill: [/save_skill/i],
};

function extractErrorSnippet(payload: string): string {
  const m = payload.match(/"error"\s*:\s*"([^"]{1,200})"/i);
  if (m?.[1]) return m[1];
  const line = payload.split('\n').find((l) => /error|MCP error|validation/i.test(l));
  return (line || payload).slice(0, 200);
}

const URL_RE = /https?:\/\/[^\s"'`<>()\[\]{}\\|]+/gi;

/** Drop trailing punctuation that markdown/prose glues onto a URL. */
function trimUrlTail(raw: string): string {
  return String(raw || '').replace(/[.,;:!?)\]}'"”』」]+$/, '');
}

/** Host + path identity so tracking params / anchors don't cause false mismatches. */
export function normalizeUrl(raw: string): string {
  const cleaned = trimUrlTail(raw);
  try {
    const u = new URL(cleaned);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${path}`;
  } catch {
    return cleaned.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
}

function extractUrls(text: string, limit = 60): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of String(text || '').matchAll(URL_RE)) {
    const url = trimUrlTail(match[0]);
    if (!url) continue;
    const key = normalizeUrl(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

/** Pull url/title/snippet hits out of a tool payload (JSON or prose). */
function extractSourcesFromPayload(payload: string, limit = 24): ExecutionSource[] {
  const sources: ExecutionSource[] = [];
  const seen = new Set<string>();
  const push = (raw: { url?: unknown; title?: unknown; snippet?: unknown }) => {
    const url = trimUrlTail(String(raw.url || ''));
    if (!/^https?:\/\//i.test(url)) return;
    const key = normalizeUrl(url);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const title = String(raw.title || '').trim().slice(0, 200) || undefined;
    const snippet = String(raw.snippet || '').trim().slice(0, 500) || undefined;
    sources.push({ url, title, snippet });
  };

  try {
    const parsed = JSON.parse(payload) as unknown;
    const walk = (node: unknown, depth = 0) => {
      if (depth > 6 || sources.length >= limit || node == null) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      if (typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (obj.url || obj.link || obj.href) {
        push({
          url: obj.url || obj.link || obj.href,
          title: obj.title || obj.name,
          snippet: obj.snippet || obj.description || obj.content || obj.summary,
        });
      }
      for (const v of Object.values(obj)) walk(v, depth + 1);
    };
    walk(parsed);
  } catch {
    // non-JSON payloads fall through to URL scrape below
  }

  if (!sources.length) {
    for (const url of extractUrls(payload, limit)) {
      push({ url });
    }
  }
  return sources.slice(0, limit);
}

/** Build a receipt list from OpenAI-style tool messages in the current turn. */
export function buildExecutionRecordFromMessages(messages: ChatMessageLike[]): ExecutionRecordEntry[] {
  const pending = new Map<string, string>();
  const entries: ExecutionRecordEntry[] = [];

  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        const id = String(tc.id || '').trim();
        const name = String(tc.function?.name || 'unknown').trim();
        if (id) pending.set(id, name);
      }
    }
    if (m.role === 'tool') {
      const id = String(m.tool_call_id || '').trim();
      const name = pending.get(id) || 'unknown';
      const payload = String(m.content || '');
      const failed =
        /"ok"\s*:\s*false/i.test(payload) ||
        /"error"\s*:\s*"/i.test(payload) ||
        /MCP error|Input validation error|invalid_type/i.test(payload);
      const sources = extractSourcesFromPayload(payload);
      const urls = sources.map((s) => s.url);
      entries.push({
        tool: name,
        ok: !failed,
        error: failed ? extractErrorSnippet(payload) : undefined,
        ...(urls.length ? { urls } : {}),
        ...(sources.length ? { sources } : {}),
      });
    }
  }
  return entries;
}

/** Build receipts from persisted assistant toolRuns (request-review of a prior turn). */
export function buildExecutionRecordFromToolRuns(toolRuns: ClientToolRun[]): ExecutionRecordEntry[] {
  return (toolRuns || [])
    .filter((r) => r.status === 'done')
    .map((r) => {
      const sources: ExecutionSource[] = [];
      const seen = new Set<string>();
      for (const x of r.results || []) {
        const url = trimUrlTail(String(x?.url || ''));
        if (!/^https?:\/\//i.test(url)) continue;
        const key = normalizeUrl(url);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        sources.push({
          url,
          title: String(x?.title || '').trim().slice(0, 200) || undefined,
          snippet: String(x?.snippet || '').trim().slice(0, 500) || undefined,
        });
      }
      const urls = sources.map((s) => s.url);
      return {
        tool: String(r.name || 'unknown'),
        provider: r.provider,
        ok: !r.error,
        error: r.error,
        query: r.query,
        ...(urls.length ? { urls } : {}),
        ...(sources.length ? { sources } : {}),
      };
    });
}

function summarizeRecord(record: ExecutionRecordEntry[]): string {
  if (!record.length) return 'No tool receipts in this turn.';
  return record
    .map((e) => {
      const status = e.ok ? 'ok' : `failed${e.error ? `: ${e.error}` : ''}`;
      return `${e.tool} (${status})`;
    })
    .join('; ');
}

function hasSuccessfulTool(record: ExecutionRecordEntry[], surface: FakedToolSurface): boolean {
  const patterns = SURFACE_TOOL_PATTERNS[surface];
  return record.some((e) => e.ok && patterns.some((p) => p.test(e.tool)));
}

function findFailedTool(
  record: ExecutionRecordEntry[],
  surface: FakedToolSurface,
): ExecutionRecordEntry | undefined {
  const patterns = SURFACE_TOOL_PATTERNS[surface];
  return record.find((e) => !e.ok && patterns.some((p) => p.test(e.tool)));
}

function findingId(surface: FakedToolSurface, verdict: ReviewFindingVerdict): string {
  return `${surface}:${verdict}`;
}

/** Heuristic verifier: compare narrated claims against tool receipts. */
export function synthesizeFindings(
  assistantText: string,
  record: ExecutionRecordEntry[],
  opts: { searchEnabled: boolean; integrations: string[]; skillCreator?: boolean },
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const recordSummary = summarizeRecord(record);
  const seen = new Set<string>();

  const push = (finding: Omit<ReviewFinding, 'id'>) => {
    const id = findingId(finding.surface, finding.verdict);
    if (seen.has(id)) return;
    seen.add(id);
    findings.push({ ...finding, id });
  };

  for (const surface of detectPendingToolIntent(assistantText, opts)) {
    push({
      severity: 'error',
      surface,
      verdict: 'pending_intent',
      claim: `Announced ${INTENT_LABELS[surface]} but emitted no tool_calls`,
      evidence: recordSummary,
    });
  }

  for (const surface of detectFakedToolNarration(assistantText, opts)) {
    const failed = findFailedTool(record, surface);
    if (failed) {
      push({
        severity: 'error',
        surface,
        verdict: 'tool_failed',
        claim: `Claimed ${SURFACE_LABELS[surface]} succeeded`,
        evidence: `${failed.tool} failed${failed.error ? `: ${failed.error}` : ''}. ${recordSummary}`,
      });
    } else if (!hasSuccessfulTool(record, surface)) {
      push({
        severity: 'error',
        surface,
        verdict: 'no_receipt',
        claim: `Claimed ${SURFACE_LABELS[surface]} without a matching successful tool receipt`,
        evidence: recordSummary,
      });
    }
  }

  return findings;
}

export type ReviewCheckKind =
  | 'mid_turn'
  | 'tool_receipt'
  | 'citation'
  | 'staleness'
  | 'recalculation'
  | 'consistency'
  | 'completeness'
  | 'code_quality'
  | 'vulnerability';

export type ReviewCheckStatus = 'running' | 'done' | 'skipped';

export type ReviewCheckItem = {
  severity: 'error' | 'warn';
  title: string;
  detail: string;
};

export type ReviewCheck = {
  id: ReviewCheckKind;
  kind: ReviewCheckKind;
  status: ReviewCheckStatus;
  /** Short one-line status for the collapsed row. */
  summary: string;
  clean?: boolean;
  items: ReviewCheckItem[];
  /** Optional expanded body (e.g. execution record dump). */
  body?: string;
};

export type ReviewReport = {
  phase: ReviewerPhase;
  status: 'running' | 'done';
  checks: ReviewCheck[];
};

/** Built-in reviewer checks (product layer, not MCP / model tools). Display order. */
export const REVIEWER_CHECK_KINDS: ReviewCheckKind[] = [
  'mid_turn',
  'tool_receipt',
  'citation',
  'staleness',
  'recalculation',
  'consistency',
  'completeness',
  'code_quality',
  'vulnerability',
];

/**
 * Everything a check may look at. Built once per audit so triggers stay cheap.
 */
export type ReviewInput = {
  assistantText: string;
  record: ExecutionRecordEntry[];
  findings: ReviewFinding[];
  phase: ReviewerPhase;
  midTurn?: MidTurnCorrection | null;
  /** The question being answered — completeness compares against it. */
  userAsk?: string;
  /** Stream was cut off (finish_reason=length, aborted, timeout). */
  truncated?: boolean;
  finishReason?: string | null;
  /** Injectable for deterministic staleness tests. */
  now?: Date;
};

export type MidTurnCorrectionKind = 'intent' | 'success';

export type MidTurnCorrection = {
  surfaces: FakedToolSurface[];
  kind: MidTurnCorrectionKind;
};

export function buildMidTurnCheck(
  surfaces: FakedToolSurface[],
  kind: MidTurnCorrectionKind,
): ReviewCheck {
  const labels = surfaces.map((s) =>
    kind === 'intent' ? INTENT_LABELS[s] : SURFACE_LABELS[s],
  );
  return {
    id: 'mid_turn',
    kind: 'mid_turn',
    status: 'done',
    clean: false,
    summary:
      kind === 'intent'
        ? 'Announced tools without tool_calls — retry injected'
        : 'Narrated tool success without receipts — correction injected',
    items: labels.map((label) => ({
      severity: 'error',
      title: label,
      detail:
        kind === 'intent'
          ? 'Stopped after announcing intent; reviewer forced another tool round.'
          : 'Claimed success with no matching tool_calls; reviewer injected corrective prompt.',
    })),
  };
}

/** Live partial report while mid-turn fires — only the checks that actually ran. */
export function buildMidTurnLiveReport(mid: MidTurnCorrection): ReviewReport {
  return {
    phase: 'mid',
    status: 'running',
    checks: [buildMidTurnCheck(mid.surfaces, mid.kind)],
  };
}

export function emitMidTurnReview(
  send: (payload: Record<string, unknown>) => void,
  mid: MidTurnCorrection,
): void {
  emitReviewReport(send, buildMidTurnLiveReport(mid));
}

/** Hosts that are never real citations (examples, local dev, spec boilerplate). */
const NON_CITATION_HOST_RE =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|.*\.local|example\.(com|org|net)|your-domain\.\w+|w3\.org|json-schema\.org|schema\.org|placeholder\.\w+)$/i;

function hostOf(url: string): string {
  try {
    return new URL(trimUrlTail(url)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Retrieval-style receipts are what make citations verifiable. */
function hasRetrievalReceipt(record: ExecutionRecordEntry[]): boolean {
  return record.some(
    (e) =>
      e.ok &&
      ((e.urls?.length || 0) > 0 ||
        (e.sources?.length || 0) > 0 ||
        /search|fetch|read|list|query|get|retrieve/i.test(e.tool)),
  );
}

function collectSources(record: ExecutionRecordEntry[]): ExecutionSource[] {
  const out: ExecutionSource[] = [];
  const seen = new Set<string>();
  for (const entry of record) {
    const hits =
      entry.sources?.length
        ? entry.sources
        : (entry.urls || []).map((url) => ({ url }));
    for (const hit of hits) {
      const key = normalizeUrl(hit.url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(hit);
    }
  }
  return out;
}

export type CitationAnchor = {
  url: string;
  /** Surrounding claim the citation is meant to support. */
  claim: string;
};

/** Numbers / years / percentages that a citation should be able to back. */
function extractFactualTokens(text: string): string[] {
  const tokens = new Set<string>();
  const src = String(text || '');
  for (const m of src.matchAll(
    /\b(?:19|20)\d{2}\b|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?\s?(?:万|亿|亿人|万人|USD|CNY|美元|元|亿欧元)\b|\b\d{4,}\b/g,
  )) {
    tokens.add(m[0].replace(/\s+/g, ''));
  }
  return [...tokens].slice(0, 12);
}

function sourceText(source: ExecutionSource): string {
  return [source.title, source.snippet].filter(Boolean).join(' ').toLowerCase();
}

function clauseBefore(text: string, idx: number, lookback = 120): string {
  const before = text.slice(Math.max(0, idx - lookback), idx);
  const parts = before.split(/[\n。！？]|[.!?](?=\s|$)/);
  return parts.pop()?.trim() || '';
}

function clauseAfter(text: string, end: number, lookahead = 160): string {
  const after = text.slice(end, Math.min(text.length, end + lookahead));
  const parts = after.split(/[\n。！？]|[.!?](?=\s|$)/);
  return parts[0]?.trim() || '';
}

/**
 * Extract citation anchors: markdown links + bare URLs, each with a short claim
 * window (the sentence / clause that the link is backing).
 */
export function extractCitationAnchors(assistantText: string): CitationAnchor[] {
  const text = stripCodeBlocks(assistantText);
  if (!text.trim()) return [];

  const anchors: CitationAnchor[] = [];
  const seen = new Set<string>();

  const push = (url: string, claim: string) => {
    const host = hostOf(url);
    if (!host || NON_CITATION_HOST_RE.test(host)) return;
    const key = `${normalizeUrl(url)}|${claim.slice(0, 80)}`;
    if (seen.has(key)) return;
    seen.add(key);
    anchors.push({ url: trimUrlTail(url), claim: claim.replace(/\s+/g, ' ').trim().slice(0, 280) });
  };

  // Markdown links: [label](url) — claim = surrounding clause (before + after) + label.
  const mdLinkRe = /\[([^\]]{1,120})\]\((https?:\/\/[^)\s]+)\)/g;
  for (const match of text.matchAll(mdLinkRe)) {
    const label = match[1].trim();
    const url = match[2];
    const idx = match.index ?? 0;
    const end = idx + match[0].length;
    const claim = [clauseBefore(text, idx), label, clauseAfter(text, end)]
      .filter(Boolean)
      .join(' — ');
    push(url, claim || label || url);
  }

  // Bare URLs not already covered as markdown targets.
  const covered = new Set(anchors.map((a) => normalizeUrl(a.url)));
  for (const match of text.matchAll(URL_RE)) {
    const url = trimUrlTail(match[0]);
    if (covered.has(normalizeUrl(url))) continue;
    const idx = match.index ?? 0;
    const end = idx + match[0].length;
    const claim = [clauseBefore(text, idx, 180), clauseAfter(text, end, 40)]
      .filter(Boolean)
      .join(' — ');
    push(url, claim || url);
  }

  return anchors.slice(0, 24);
}

export type CitationAudit = {
  checked: number;
  matched: number;
  unsupported: string[];
  /** Claims whose hard facts do not appear in the matched source snippet. */
  unsupportedClaims: Array<{ url: string; claim: string; missing: string[] }>;
};

/**
 * Citation audit: (1) URL must appear in tool hits, (2) hard facts near the
 * citation should appear in the source title/snippet when those exist.
 */
export function auditCitations(
  assistantText: string,
  record: ExecutionRecordEntry[],
): CitationAudit | null {
  if (!hasRetrievalReceipt(record)) return null;
  const sources = collectSources(record);
  if (!sources.length) return null;

  const byUrl = new Map(sources.map((s) => [normalizeUrl(s.url), s]));
  const anchors = extractCitationAnchors(assistantText);
  if (!anchors.length) return null;

  const unsupported: string[] = [];
  const unsupportedClaims: CitationAudit['unsupportedClaims'] = [];
  const seenUnsupported = new Set<string>();
  let matched = 0;

  for (const anchor of anchors) {
    const key = normalizeUrl(anchor.url);
    const source = byUrl.get(key);
    if (!source) {
      if (!seenUnsupported.has(key)) {
        seenUnsupported.add(key);
        unsupported.push(anchor.url);
      }
      continue;
    }
    matched++;

    const hay = sourceText(source);
    if (!hay) continue; // URL-only receipt — can't verify content yet.
    const facts = extractFactualTokens(anchor.claim);
    if (facts.length < 1) continue;
    const missing = facts.filter(
      (t) => !hay.includes(t.toLowerCase()) && !hay.includes(t.replace(/,/g, '')),
    );
    if (!missing.length) continue;
    // Snippets are partial — only flag distinctive figures (%, decimals, large nums),
    // not a lone year that happens to be absent from a short blurb.
    const notable = missing.filter((t) => {
      if (/%/.test(t) || /\.\d/.test(t) || /,/.test(t)) return true;
      const n = Number(String(t).replace(/[^\d.]/g, ''));
      return Number.isFinite(n) && (n >= 100 || String(t).length >= 4);
    });
    if (!notable.length) continue;
    unsupportedClaims.push({
      url: anchor.url,
      claim: anchor.claim,
      missing: notable.slice(0, 4),
    });
  }

  return {
    checked: anchors.length,
    matched,
    unsupported,
    unsupportedClaims: unsupportedClaims.slice(0, 8),
  };
}

/** Independent citation check. Null when there is nothing citation-related to verify. */
export function buildCitationCheck(
  assistantText: string,
  record: ExecutionRecordEntry[],
): ReviewCheck | null {
  const audit = auditCitations(assistantText, record);
  if (!audit) return null;

  const items: ReviewCheckItem[] = [];
  for (const url of audit.unsupported.slice(0, 8)) {
    items.push({
      severity: 'warn',
      title: `Link not in tool results: ${url}`,
      detail: 'This URL never appeared in any retrieval payload — verify it or remove it.',
    });
  }
  for (const row of audit.unsupportedClaims.slice(0, 8)) {
    items.push({
      severity: 'warn',
      title: row.claim.slice(0, 120) || row.url,
      detail: `Cited ${row.url}, but source snippet is missing: ${row.missing.join(', ')}`,
    });
  }

  const bits = [`${audit.matched}/${audit.checked} links in receipts`];
  if (audit.unsupportedClaims.length) {
    bits.push(`${audit.unsupportedClaims.length} claim(s) not backed by snippet`);
  }

  return {
    id: 'citation',
    kind: 'citation',
    status: 'done',
    clean: items.length === 0,
    summary:
      items.length === 0
        ? `Verified ${bits[0]}`
        : `${items.length} citation issue(s) · ${bits.join(' · ')}`,
    items,
  };
}

export function buildToolReceiptCheck(
  findings: ReviewFinding[],
  record: ExecutionRecordEntry[],
): ReviewCheck {
  const items: ReviewCheckItem[] = findings.map((f) => ({
    severity: f.severity,
    title: f.claim,
    detail: f.evidence,
  }));

  const clean = items.length === 0;
  return {
    id: 'tool_receipt',
    kind: 'tool_receipt',
    status: 'done',
    clean,
    summary: clean
      ? 'All checked claims match tool receipts'
      : `${items.length} issue(s) in tool usage`,
    items,
    body: formatExecutionRecordForVerifier(record),
  };
}

/** Strip fenced code blocks — code often contains deliberately wrong sample math. */
function stripCodeBlocks(text: string): string {
  return String(text || '').replace(/```[\s\S]*?(?:```|$)/g, '\n');
}

function parseNumberToken(raw: string): number {
  return parseFloat(String(raw).replace(/[,\s_]/g, ''));
}

type Token = { type: 'num'; value: number } | { type: 'op'; value: string } | { type: 'paren'; value: '(' | ')' };

const OP_PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

function normalizeOperator(ch: string): string | null {
  if (ch === '+' || ch === '＋') return '+';
  if (ch === '-' || ch === '－' || ch === '−') return '-';
  if (ch === '*' || ch === '×' || ch === '·') return '*';
  if (ch === '/' || ch === '÷') return '/';
  return null;
}

function tokenizeArithmetic(expr: string): Token[] | null {
  const tokens: Token[] = [];
  const src = String(expr || '');
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[\d.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[\d.,_]/.test(src[j])) j++;
      const numRaw = src.slice(i, j);
      let value = parseNumberToken(numRaw);
      if (!Number.isFinite(value)) return null;
      // Percent literal folds into a fraction so 20% * 50 works.
      if (src[j] === '%' || src[j] === '％') {
        value = value / 100;
        j++;
      }
      tokens.push({ type: 'num', value });
      i = j;
      continue;
    }
    if (ch === '(' || ch === '（') {
      tokens.push({ type: 'paren', value: '(' });
      i++;
      continue;
    }
    if (ch === ')' || ch === '）') {
      tokens.push({ type: 'paren', value: ')' });
      i++;
      continue;
    }
    const op = normalizeOperator(ch);
    if (op) {
      tokens.push({ type: 'op', value: op });
      i++;
      continue;
    }
    return null;
  }
  return tokens.length ? tokens : null;
}

/** Shunting-yard evaluation. No eval() — only numbers, + - * / and parentheses. */
function evaluateArithmetic(expr: string): number | null {
  const tokens = tokenizeArithmetic(expr);
  if (!tokens) return null;

  const output: Token[] = [];
  const ops: Token[] = [];
  let prev: Token | null = null;

  for (const token of tokens) {
    if (token.type === 'num') {
      output.push(token);
    } else if (token.type === 'op') {
      // Unary +/- becomes 0 <op> value.
      const isUnary =
        !prev || (prev.type === 'op') || (prev.type === 'paren' && prev.value === '(');
      if (isUnary) {
        if (token.value !== '+' && token.value !== '-') return null;
        output.push({ type: 'num', value: 0 });
      }
      while (
        ops.length &&
        ops[ops.length - 1].type === 'op' &&
        OP_PRECEDENCE[(ops[ops.length - 1] as { value: string }).value] >=
          OP_PRECEDENCE[token.value]
      ) {
        output.push(ops.pop()!);
      }
      ops.push(token);
    } else if (token.value === '(') {
      ops.push(token);
    } else {
      let matched = false;
      while (ops.length) {
        const top = ops.pop()!;
        if (top.type === 'paren' && top.value === '(') {
          matched = true;
          break;
        }
        output.push(top);
      }
      if (!matched) return null;
    }
    prev = token;
  }
  while (ops.length) {
    const top = ops.pop()!;
    if (top.type === 'paren') return null;
    output.push(top);
  }

  const stack: number[] = [];
  for (const token of output) {
    if (token.type === 'num') {
      stack.push(token.value);
      continue;
    }
    if (token.type !== 'op') return null;
    const b = stack.pop();
    const a = stack.pop();
    if (a == null || b == null) return null;
    if (token.value === '+') stack.push(a + b);
    else if (token.value === '-') stack.push(a - b);
    else if (token.value === '*') stack.push(a * b);
    else {
      if (b === 0) return null;
      stack.push(a / b);
    }
  }
  if (stack.length !== 1 || !Number.isFinite(stack[0])) return null;
  return stack[0];
}

/**
 * Accept the claim when it matches the exact value or the value rounded to the
 * precision the author used (2/3 → 0.67 is correct, not a mismatch).
 */
function matchesWithinRounding(actual: number, claimedRaw: string, claimed: number): boolean {
  const tolerance = Math.max(1e-9, Math.abs(actual) * 1e-9);
  if (Math.abs(actual - claimed) <= tolerance) return true;
  const decimals = (claimedRaw.split(/[.]/)[1] || '').replace(/[^\d]/g, '').length;
  const factor = 10 ** decimals;
  if (Math.abs(Math.round(actual * factor) / factor - claimed) <= tolerance) return true;
  // Significant-figure rounding (1234 → 1200) stays acceptable for prose.
  if (decimals === 0 && Math.abs(actual) >= 100) {
    const rel = Math.abs(actual - claimed) / Math.abs(actual);
    if (rel <= 0.005) return true;
  }
  return false;
}

const EQUATION_RE =
  /(?<![\w.])((?:\(?\s*[-−]?\s*[\d][\d.,_]*\s*[%％]?\s*\)?(?:\s*[+\-−＋－*/×÷·]\s*\(?\s*[\d][\d.,_]*\s*[%％]?\s*\)?)+))\s*[=＝]\s*([-−]?\s*[\d][\d.,_]*)\s*([%％])?/g;

type EquationFinding = { expression: string; actual: number; claimed: number };

/** Verify inline equations like `1,200 × 3 + 40 = 3,640` (percent aware). */
function verifyInlineEquations(text: string): {
  checked: number;
  mismatches: EquationFinding[];
} {
  const mismatches: EquationFinding[] = [];
  let checked = 0;

  for (const match of text.matchAll(EQUATION_RE)) {
    const lhsRaw = match[1];
    const rhsRaw = match[2];
    const rhsPercent = Boolean(match[3]);

    let actual = evaluateArithmetic(lhsRaw);
    if (actual == null) continue;
    const claimed = parseNumberToken(rhsRaw.replace(/[−]/g, '-'));
    if (!Number.isFinite(claimed)) continue;

    // Percent literals are folded to fractions while tokenizing, so a percent
    // claim ("12 / 50 = 24%", "50% + 30% = 80%") scales back up here.
    if (rhsPercent) actual *= 100;

    checked++;
    if (!matchesWithinRounding(actual, rhsRaw, claimed)) {
      mismatches.push({
        expression: `${lhsRaw.trim()} = ${rhsRaw.trim()}${rhsPercent ? '%' : ''}`,
        actual,
        claimed,
      });
    }
  }
  return { checked, mismatches };
}

// `\b` never matches after a CJK label, so ASCII keywords carry the boundary alone.
const TOTAL_ROW_RE =
  /^\s*\**\s*(?:合计|总计|小计|总和|汇总|(?:total|totals|sum|subtotal)\b)/i;

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:-]*-{2,}[\s|:-]*\|?\s*$/.test(line) && line.includes('-');
}

function cellNumber(cell: string): number | null {
  const raw = String(cell || '').replace(/[*_`]/g, '').trim();
  if (!raw) return null;
  const m = raw.match(/^[¥$€£]?\s*([-−]?[\d][\d.,_]*)\s*[%％]?$/);
  if (!m) return null;
  const value = parseNumberToken(m[1].replace(/[−]/g, '-'));
  return Number.isFinite(value) ? value : null;
}

/** Verify `合计 / Total` rows in markdown tables against the column sum. */
function verifyTableTotals(text: string): {
  checked: number;
  mismatches: Array<{ label: string; column: string; actual: number; claimed: number }>;
} {
  const lines = String(text || '').split('\n');
  const mismatches: Array<{ label: string; column: string; actual: number; claimed: number }> = [];
  let checked = 0;

  let i = 0;
  while (i < lines.length) {
    if (!lines[i].includes('|') || !isTableSeparator(lines[i + 1] || '')) {
      i++;
      continue;
    }
    const header = splitTableRow(lines[i]);
    let j = i + 2;
    const body: string[][] = [];
    while (j < lines.length && lines[j].includes('|') && lines[j].trim()) {
      body.push(splitTableRow(lines[j]));
      j++;
    }

    const totalRows = body.filter((row) => TOTAL_ROW_RE.test(row[0] || ''));
    const dataRows = body.filter((row) => !TOTAL_ROW_RE.test(row[0] || ''));

    if (totalRows.length && dataRows.length >= 2) {
      for (const totalRow of totalRows) {
        for (let col = 1; col < header.length; col++) {
          const claimed = cellNumber(totalRow[col] || '');
          if (claimed == null) continue;
          const values = dataRows
            .map((row) => cellNumber(row[col] || ''))
            .filter((v): v is number => v != null);
          if (values.length < 2 || values.length !== dataRows.length) continue;
          const actual = values.reduce((a, b) => a + b, 0);
          checked++;
          if (!matchesWithinRounding(actual, totalRow[col] || '', claimed)) {
            mismatches.push({
              label: (totalRow[0] || 'total').replace(/[*_`]/g, '').trim(),
              column: (header[col] || `col ${col + 1}`).replace(/[*_`]/g, '').trim(),
              actual,
              claimed,
            });
          }
        }
      }
    }
    i = j + 1;
  }
  return { checked, mismatches };
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1e6) / 1e6);
}

/** Arithmetic check (验算): verify claimed equations and table totals. Null when nothing to check. */
export function buildRecalculationCheck(assistantText: string): ReviewCheck | null {
  const text = stripCodeBlocks(assistantText);
  if (!text.trim()) return null;

  const items: ReviewCheckItem[] = [];
  const inline = verifyInlineEquations(text);
  const tables = verifyTableTotals(text);
  const checked = inline.checked + tables.checked;
  if (checked === 0) return null;

  for (const m of inline.mismatches.slice(0, 8)) {
    items.push({
      severity: 'error',
      title: m.expression,
      detail: `Verified as ${formatNumber(m.actual)} (answer said ${formatNumber(m.claimed)})`,
    });
  }
  for (const m of tables.mismatches.slice(0, 8)) {
    items.push({
      severity: 'error',
      title: `${m.label} · ${m.column}`,
      detail: `Column verifies as ${formatNumber(m.actual)} (table said ${formatNumber(m.claimed)})`,
    });
  }

  const scopeBits: string[] = [];
  if (inline.checked) scopeBits.push(`${inline.checked} expression(s)`);
  if (tables.checked) scopeBits.push(`${tables.checked} table total(s)`);

  return {
    id: 'recalculation',
    kind: 'recalculation',
    status: 'done',
    clean: items.length === 0,
    summary:
      items.length === 0
        ? `Checked ${scopeBits.join(' + ')}`
        : `${items.length} mismatch(es) in ${scopeBits.join(' + ')}`,
    items,
  };
}

type CodeBlock = { lang: string; code: string };

/** Fenced code blocks with their declared language (unterminated tail included). */
export function extractCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const re = /```([\w+#.-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g;
  for (const match of String(text || '').matchAll(re)) {
    const code = match[2] || '';
    if (code.trim()) blocks.push({ lang: (match[1] || '').toLowerCase(), code });
  }
  return blocks;
}

type VulnRule = {
  id: string;
  re: RegExp;
  title: string;
  detail: string;
  severity: 'error' | 'warn';
  /** code = only inside fenced blocks; both = anywhere in the answer. */
  scope: 'code' | 'both';
  /** Drop the hit when the matched text is an obvious placeholder. */
  skipPlaceholders?: boolean;
};

/** `sk-xxxx`, `YOUR_API_KEY`, `<token>` etc. are docs, not leaked secrets. */
const PLACEHOLDER_RE =
  /your[_-]?|placeholder|example|sample|changeme|change[_-]?me|dummy|redacted|\bfake\b|xxx+|\.{3,}|\*{3,}|<[^>]{1,40}>|\$\{|process\.env|os\.environ|secrets?\./i;

/** Graded rule set: secrets anywhere, injection / sink patterns inside code only. */
const VULN_RULES: VulnRule[] = [
  {
    id: 'aws-key',
    re: /\bAKIA[0-9A-Z]{16}\b/,
    title: 'AWS access key ID',
    detail: 'Hardcoded cloud credential — rotate it and load from env/secret manager.',
    severity: 'error',
    scope: 'both',
    skipPlaceholders: true,
  },
  {
    id: 'openai-key',
    re: /\bsk-[a-zA-Z0-9_-]{20,}\b/,
    title: 'API secret key (sk-…)',
    detail: 'Token-like secret in plaintext — move to an environment variable.',
    severity: 'error',
    scope: 'both',
    skipPlaceholders: true,
  },
  {
    id: 'github-pat',
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/,
    title: 'GitHub personal access token',
    detail: 'Revoke the token; never embed PATs in code or chat.',
    severity: 'error',
    scope: 'both',
    skipPlaceholders: true,
  },
  {
    id: 'google-key',
    re: /\bAIza[0-9A-Za-z_-]{30,}\b/,
    title: 'Google API key',
    detail: 'Restrict and rotate the key; keep it server-side.',
    severity: 'error',
    scope: 'both',
  },
  {
    id: 'slack-token',
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
    title: 'Slack token',
    detail: 'Revoke immediately — Slack tokens grant workspace access.',
    severity: 'error',
    scope: 'both',
  },
  {
    id: 'private-key',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    title: 'Private key block',
    detail: 'Private key material must never appear in source or chat.',
    severity: 'error',
    scope: 'both',
  },
  {
    id: 'hardcoded-credential',
    re: /\b(api[_-]?key|apikey|secret|password|passwd|token|access[_-]?key)\s*[:=]\s*['"`][^'"`\n]{8,}['"`]/i,
    title: 'Hardcoded credential assignment',
    detail: 'key/secret/password assigned a literal value — read from config instead.',
    severity: 'error',
    scope: 'both',
    skipPlaceholders: true,
  },
  {
    id: 'sql-injection',
    re: /(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|DROP\s+TABLE)\b[\s\S]{0,160}?(?:\$\{|"\s*\+\s*|'\s*\+\s*|%\s*\(|%s|f["'])/i,
    title: 'SQL built by string interpolation',
    detail: 'Use parameterized queries / prepared statements instead of concatenation.',
    severity: 'error',
    scope: 'code',
  },
  {
    id: 'shell-injection',
    re: /(?:child_process\.)?exec(?:Sync)?\s*\(\s*[`'"][^`'"]*\$\{|\bos\.system\s*\(|subprocess\.\w+\([^)]*shell\s*=\s*True/,
    title: 'Shell command with interpolated input',
    detail: 'Command injection risk — use argument arrays and avoid shell=True.',
    severity: 'error',
    scope: 'code',
  },
  {
    id: 'eval',
    re: /(?:^|[^.\w])eval\s*\(|new\s+Function\s*\(/,
    title: 'eval() / new Function()',
    detail: 'Dynamic code execution — remove it or strictly validate the input.',
    severity: 'error',
    scope: 'code',
  },
  {
    id: 'deserialization',
    re: /pickle\.loads?\s*\(|yaml\.load\s*\((?![^)]*SafeLoader)|Marshal\.load\s*\(/,
    title: 'Unsafe deserialization',
    detail: 'Use safe loaders (yaml.safe_load, JSON) for untrusted data.',
    severity: 'error',
    scope: 'code',
  },
  {
    id: 'react-dangerous-html',
    re: /dangerouslySetInnerHTML/,
    title: 'dangerouslySetInnerHTML',
    detail: 'XSS sink — sanitize the HTML (e.g. DOMPurify) before injecting.',
    severity: 'warn',
    scope: 'code',
  },
  {
    id: 'dom-xss',
    re: /\.innerHTML\s*=|document\.write\s*\(|\.outerHTML\s*=/,
    title: 'DOM XSS sink',
    detail: 'Prefer textContent, or sanitize before assigning HTML.',
    severity: 'warn',
    scope: 'code',
  },
  {
    id: 'tls-disabled',
    re: /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/,
    title: 'TLS verification disabled',
    detail: 'Disabling certificate checks enables man-in-the-middle attacks.',
    severity: 'error',
    scope: 'code',
  },
  {
    id: 'weak-hash',
    re: /(?:md5|sha1)\s*\([^)]*(?:password|passwd|secret|token)|createHash\s*\(\s*['"](?:md5|sha1)['"]/i,
    title: 'Weak hash for secrets',
    detail: 'Use bcrypt / argon2 / scrypt for passwords, SHA-256+ elsewhere.',
    severity: 'warn',
    scope: 'code',
  },
  {
    id: 'insecure-random',
    re: /Math\.random\s*\(\s*\)[\s\S]{0,60}?(?:token|secret|password|nonce|salt|session)|(?:token|secret|password|nonce|salt|session)[\s\S]{0,40}?Math\.random\s*\(/i,
    title: 'Math.random() for security value',
    detail: 'Use crypto.randomUUID / randomBytes for tokens and salts.',
    severity: 'warn',
    scope: 'code',
  },
  {
    id: 'jwt-unverified',
    re: /algorithms\s*:\s*\[\s*['"]none['"]|jwt\.decode\s*\((?![^)]*verify)|verify\s*:\s*false/i,
    title: 'JWT accepted without verification',
    detail: 'Always verify the signature and pin the expected algorithm.',
    severity: 'error',
    scope: 'code',
  },
  {
    id: 'cors-wildcard',
    re: /Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*['"]|origin\s*:\s*['"]\*['"]/i,
    title: 'Wildcard CORS origin',
    detail: 'Avoid `*` when credentials are involved — allowlist real origins.',
    severity: 'warn',
    scope: 'code',
  },
  {
    id: 'world-writable',
    re: /chmod\s+(?:-R\s+)?777|os\.chmod\([^)]*0o777/,
    title: 'World-writable permissions (777)',
    detail: 'Grant the narrowest permissions the process actually needs.',
    severity: 'warn',
    scope: 'code',
  },
  {
    id: 'path-traversal',
    re: /(?:path\.join|open|readFile(?:Sync)?|sendFile)\s*\([^)]*(?:req\.(?:params|query|body)|request\.args|params\[)/,
    title: 'Filesystem path from user input',
    detail: 'Path traversal risk — resolve and confirm the path stays in the allowed root.',
    severity: 'warn',
    scope: 'code',
  },
];

/** Pattern scan for security red flags. Null when there is nothing to audit. */
export function buildVulnerabilityCheck(assistantText: string): ReviewCheck | null {
  const text = String(assistantText || '');
  if (!text.trim()) return null;

  const blocks = extractCodeBlocks(text);
  const codeText = blocks.map((b) => b.code).join('\n');
  const items: ReviewCheckItem[] = [];

  for (const rule of VULN_RULES) {
    const haystack = rule.scope === 'code' ? codeText : text;
    if (!haystack) continue;
    const hit = haystack.match(rule.re);
    if (!hit) continue;
    if (rule.skipPlaceholders && PLACEHOLDER_RE.test(hit[0])) continue;
    items.push({ severity: rule.severity, title: rule.title, detail: rule.detail });
    if (items.length >= 12) break;
  }

  // Nothing to audit: no code in the answer and no secret-shaped strings in prose.
  if (!blocks.length && !items.length) return null;

  const errors = items.filter((i) => i.severity === 'error').length;
  const warns = items.length - errors;
  const scope = blocks.length
    ? `${blocks.length} code block(s)`
    : 'answer text';

  return {
    id: 'vulnerability',
    kind: 'vulnerability',
    status: 'done',
    clean: items.length === 0,
    summary: items.length
      ? [errors ? `${errors} high` : '', warns ? `${warns} warning` : '']
          .filter(Boolean)
          .join(' + ') + ` in ${scope}`
      : `No known-risk patterns in ${scope}`,
    items,
  };
}

// ---------------------------------------------------------------------------
// Code quality (correctness smells, distinct from the security audit)
// ---------------------------------------------------------------------------

type CodeLang = 'js' | 'py' | 'other';

const JS_FENCE_RE = /^(js|jsx|ts|tsx|javascript|typescript|mjs|cjs|node)$/;
const PY_FENCE_RE = /^(py|python|python3)$/;

/** Models often omit the fence language, so fall back to sniffing the body. */
function inferCodeLang(block: CodeBlock): CodeLang {
  if (JS_FENCE_RE.test(block.lang)) return 'js';
  if (PY_FENCE_RE.test(block.lang)) return 'py';
  if (block.lang) return 'other';
  if (/\bdef\s+\w+\s*\(|\bimport\s+\w+\s*$|\bself\b|\belif\b/m.test(block.code)) return 'py';
  if (/\b(?:const|let|function|=>|export|require\()\b/.test(block.code)) return 'js';
  return 'other';
}

type CodeQualityRule = {
  id: string;
  re: RegExp;
  title: string;
  detail: string;
  severity: 'error' | 'warn';
  langs?: CodeLang[];
};

const CODE_QUALITY_RULES: CodeQualityRule[] = [
  {
    id: 'off-by-one',
    re: /(?:<=\s*\w+(?:\.\w+)*\.length\b|<=\s*len\s*\([^)]*\))/,
    title: 'Off-by-one loop bound',
    detail: '`<= length` runs one iteration past the last index — use `<`.',
    severity: 'error',
  },
  {
    id: 'mutable-default-arg',
    re: /def\s+\w+\s*\([^)]*=\s*(?:\[\s*\]|\{\s*\}|set\(\))/,
    title: 'Mutable default argument',
    detail: 'Python evaluates defaults once — use `None` and build inside the function.',
    severity: 'error',
    langs: ['py'],
  },
  {
    id: 'loose-equality',
    re: /(?<![=!<>])==(?!=)|(?<!!)!=(?!=)/,
    title: 'Loose equality (== / !=)',
    detail: 'Type coercion causes surprises — prefer `===` / `!==`.',
    severity: 'warn',
    langs: ['js'],
  },
  {
    id: 'empty-catch',
    re: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/,
    title: 'Empty catch block',
    detail: 'Swallowing the error hides failures — log or rethrow.',
    severity: 'warn',
    langs: ['js'],
  },
  {
    id: 'bare-except',
    re: /except\s*:\s*(?:\n|$)|except\s+BaseException\s*:/,
    title: 'Bare except',
    detail: 'Catches KeyboardInterrupt/SystemExit too — catch specific exceptions.',
    severity: 'warn',
    langs: ['py'],
  },
  {
    id: 'parseint-radix',
    re: /parseInt\s*\(\s*[^,()]+\)/,
    title: 'parseInt without radix',
    detail: 'Pass 10 explicitly, or use `Number()`.',
    severity: 'warn',
    langs: ['js'],
  },
  {
    id: 'float-equality',
    re: /[=!]==?\s*0\.\d+|\b0\.\d+\s*[=!]==?/,
    title: 'Floating-point equality',
    detail: 'Binary floats rarely compare equal — compare within an epsilon.',
    severity: 'warn',
  },
  {
    id: 'state-mutation',
    re: /\b(?:state|props)(?:\.\w+)+\s*=(?!=)|\b(?:state|props)\[[^\]]+\]\s*=(?!=)/,
    title: 'Direct state/props mutation',
    detail: 'React state must be replaced, not mutated, or renders are skipped.',
    severity: 'warn',
    langs: ['js'],
  },
  {
    id: 'unawaited-promise',
    re: /^\s*(?!return|await|void|yield)(?:\w+\.)*\w+\([^)]*\)\.then\s*\([^)]*\)\s*;?\s*$/m,
    title: 'Floating promise',
    detail: 'A `.then()` chain with no await/catch loses errors — await it or add `.catch`.',
    severity: 'warn',
    langs: ['js'],
  },
];

/** `.map(...)` returning JSX without a `key` prop. */
function hasMissingReactKey(code: string): boolean {
  const re = /\.map\s*\(\s*\(?[^)]*\)?\s*=>\s*\(?\s*<([A-Za-z][\w.]*)([\s\S]{0,240})/g;
  for (const match of code.matchAll(re)) {
    const tail = match[2] || '';
    const openTag = tail.split('>')[0] || '';
    if (!/\bkey\s*=/.test(openTag)) return true;
  }
  return false;
}

/** Correctness smells in code the answer proposes. Null when there is no code. */
export function buildCodeQualityCheck(assistantText: string): ReviewCheck | null {
  const blocks = extractCodeBlocks(assistantText);
  if (!blocks.length) return null;

  const items: ReviewCheckItem[] = [];
  const seen = new Set<string>();
  const add = (rule: { id: string; title: string; detail: string; severity: 'error' | 'warn' }) => {
    if (seen.has(rule.id) || items.length >= 10) return;
    seen.add(rule.id);
    items.push({ severity: rule.severity, title: rule.title, detail: rule.detail });
  };

  for (const block of blocks) {
    const lang = inferCodeLang(block);
    for (const rule of CODE_QUALITY_RULES) {
      if (rule.langs && !rule.langs.includes(lang)) continue;
      if (rule.re.test(block.code)) add(rule);
    }
    if (lang === 'js' && hasMissingReactKey(block.code)) {
      add({
        id: 'missing-react-key',
        title: 'List render without `key`',
        detail: 'React needs a stable `key` on mapped elements to reconcile correctly.',
        severity: 'warn',
      });
    }
  }

  const errors = items.filter((i) => i.severity === 'error').length;
  return {
    id: 'code_quality',
    kind: 'code_quality',
    status: 'done',
    clean: items.length === 0,
    summary: items.length
      ? `${items.length} correctness smell(s)${errors ? `, ${errors} likely bug(s)` : ''} in ${blocks.length} code block(s)`
      : `No correctness smells in ${blocks.length} code block(s)`,
    items,
  };
}

// ---------------------------------------------------------------------------
// Completeness (was the answer actually finished?)
// ---------------------------------------------------------------------------

const CN_NUMERALS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function parseAnnouncedCount(raw: string): number {
  const digits = Number(raw);
  if (Number.isFinite(digits)) return digits;
  if (raw.length === 1) return CN_NUMERALS[raw] ?? 0;
  if (raw === '十一') return 11;
  if (raw === '十二') return 12;
  return 0;
}

/** First-person promises of more output ("接下来我会…") that never arrived. */
const DANGLING_PROMISE_RE =
  /(?:接下来我(?:会|将|来)|下面我(?:会|将|来)|我(?:会|将)?(?:继续|马上|稍后)|让我先|我先来|稍后我(?:会|将)|Next,?\s+I(?:'ll| will)|I'?ll continue|Let me first)/i;

const LEFTOVER_PLACEHOLDER_RE =
  /\bTODO\b|\bFIXME\b|待补充|待完成|待确认|此处省略|（略）|\(略\)|\.\.\.\s*（后续/i;

function listItemNumbers(text: string): number[] {
  const nums: number[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s{0,3}(\d{1,2})[.)、]\s+\S/);
    if (m) nums.push(Number(m[1]));
  }
  return nums;
}

function countTopLevelListItems(text: string): number {
  let n = 0;
  for (const line of text.split('\n')) {
    if (/^\s{0,3}(?:[-*+]|\d{1,2}[.)、])\s+\S/.test(line)) n++;
  }
  return n;
}

function hasEmptyMarkdownTable(text: string): boolean {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes('|') || !isTableSeparator(lines[i + 1] || '')) continue;
    const next = lines[i + 2] || '';
    if (!next.includes('|') || !next.trim()) return true;
  }
  return false;
}

/** Did the answer finish? Null when no truncation / omission signal fires. */
export function buildCompletenessCheck(input: ReviewInput): ReviewCheck | null {
  const raw = String(input.assistantText || '');
  if (!raw.trim()) return null;

  const items: ReviewCheckItem[] = [];
  const fenceCount = (raw.match(/```/g) || []).length;

  if (input.truncated || input.finishReason === 'length') {
    items.push({
      severity: 'error',
      title: 'Answer was cut off',
      detail:
        input.finishReason === 'length'
          ? 'Generation hit the token limit — continue the reply to finish it.'
          : 'The stream ended before the reply was complete.',
    });
  }

  if (fenceCount % 2 === 1) {
    items.push({
      severity: 'error',
      title: 'Unclosed code block',
      detail: 'A ``` fence was opened and never closed — the code block is incomplete.',
    });
  }

  const text = stripCodeBlocks(raw);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const lastLine = lines[lines.length - 1] || '';
  if (lastLine.length > 12 && /[,:，、：；;（(\[{—-]$/.test(lastLine)) {
    items.push({
      severity: 'warn',
      title: 'Ends mid-sentence',
      detail: `Last line stops at "${lastLine.slice(-40)}".`,
    });
  }

  const tail = text.slice(-220);
  if (DANGLING_PROMISE_RE.test(tail)) {
    items.push({
      severity: 'warn',
      title: 'Promised more but stopped',
      detail: 'The reply announces further work at the very end without delivering it.',
    });
  }

  const nums = listItemNumbers(text);
  const gap = nums.find((n, i) => i > 0 && n !== nums[i - 1] + 1 && n !== nums[i - 1]);
  if (nums.length >= 3 && gap !== undefined) {
    items.push({
      severity: 'warn',
      title: 'Numbered list has a gap',
      detail: `Item numbering jumps to ${gap} — a step may be missing.`,
    });
  }

  const announced = text.match(/(?:分为|共有|共|一共|总共)\s*(\d{1,2}|[一二三四五六七八九十]{1,2})\s*(?:个|步|点|项|条|类|方面|部分|阶段)/);
  if (announced) {
    const expected = parseAnnouncedCount(announced[1]);
    const delivered = Math.max(countTopLevelListItems(text), nums.length);
    if (expected >= 2 && delivered > 0 && delivered < expected) {
      items.push({
        severity: 'warn',
        title: `Announced ${expected}, delivered ${delivered}`,
        detail: `The reply says "${announced[0]}" but only ${delivered} item(s) follow.`,
      });
    }
  }

  if (hasEmptyMarkdownTable(text)) {
    items.push({
      severity: 'warn',
      title: 'Empty table',
      detail: 'A table header was rendered with no data rows.',
    });
  }

  const placeholder = text.match(LEFTOVER_PLACEHOLDER_RE);
  if (placeholder) {
    items.push({
      severity: 'warn',
      title: `Placeholder left in answer: ${placeholder[0]}`,
      detail: 'Fill it in or drop it — the reader cannot act on a placeholder.',
    });
  }

  if (!items.length) return null;
  const errors = items.filter((i) => i.severity === 'error').length;
  return {
    id: 'completeness',
    kind: 'completeness',
    status: 'done',
    clean: false,
    summary: errors
      ? `Answer looks unfinished (${items.length} signal(s))`
      : `${items.length} completeness gap(s)`,
    items,
  };
}

// ---------------------------------------------------------------------------
// Staleness (time-sensitive claims without fresh evidence)
// ---------------------------------------------------------------------------

const TIME_MARKER_RE =
  /截至|截止|目前|现在|当前|最新|至今|如今|今年|本月|本周|今天|现阶段|as of|currently|latest|to date|right now|today|nowadays/i;

const SUPERLATIVE_RE = /最新|最大|最多|最高|最低|最快|第一|唯一|首个|newest|largest|fastest|best|only/i;

function splitSentences(text: string): string[] {
  return String(text || '')
    .split(/(?<=[。！？；;!?])\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function yearsIn(text: string): number[] {
  return [...String(text || '').matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
}

/** Time-sensitive assertions vs retrieval freshness. Null when nothing time-bound. */
export function buildStalenessCheck(
  assistantText: string,
  record: ExecutionRecordEntry[],
  now: Date = new Date(),
): ReviewCheck | null {
  const text = stripCodeBlocks(assistantText);
  if (!text.trim()) return null;

  const currentYear = now.getFullYear();
  const items: ReviewCheckItem[] = [];
  let timeBoundSentences = 0;

  for (const sentence of splitSentences(text)) {
    if (!TIME_MARKER_RE.test(sentence)) continue;
    const hasClaim = /\d/.test(sentence) || SUPERLATIVE_RE.test(sentence);
    if (!hasClaim) continue;
    timeBoundSentences++;

    const asOf = sentence.match(/(?:截至|截止|as of)\s*((?:19|20)\d{2})/i);
    if (asOf) {
      const year = Number(asOf[1]);
      const gap = currentYear - year;
      if (gap >= 1) {
        items.push({
          severity: gap >= 2 ? 'error' : 'warn',
          title: `Dated "${asOf[0]}" but now is ${currentYear}`,
          detail: `The claim is ${gap} year(s) behind — re-check it or state the cutoff explicitly.`,
        });
      }
    }
  }

  if (!timeBoundSentences) return null;

  const retrieval = hasRetrievalReceipt(record);
  if (!retrieval) {
    items.push({
      severity: 'warn',
      title: `${timeBoundSentences} time-sensitive claim(s) with no retrieval`,
      detail: 'Nothing was searched this turn, so "current / latest" rests on training data.',
    });
  } else {
    const sourceYears = collectSources(record).flatMap((s) =>
      yearsIn([s.title, s.snippet].filter(Boolean).join(' ')),
    );
    const newest = sourceYears.length ? Math.max(...sourceYears) : null;
    if (newest !== null && currentYear - newest >= 2) {
      items.push({
        severity: 'warn',
        title: `Newest source is from ${newest}`,
        detail: `Answer speaks about the present but sources stop at ${newest}.`,
      });
    }
  }

  return {
    id: 'staleness',
    kind: 'staleness',
    status: 'done',
    clean: items.length === 0,
    summary: items.length
      ? `${items.length} freshness risk(s) across ${timeBoundSentences} time-bound claim(s)`
      : `${timeBoundSentences} time-bound claim(s) backed by retrieval`,
    items,
  };
}

// ---------------------------------------------------------------------------
// Internal consistency (the answer contradicting itself)
// ---------------------------------------------------------------------------

const GENERIC_LABEL_RE =
  /^(?:值|数值|数量|内容|示例|例如|如下|结果|说明|备注|其中|比如|note|value|example|result|total)$/i;

const LABELED_NUMBER_RE =
  /([\p{L}\p{N}][\p{L}\p{N}_ ·%（）()-]{1,22})\s*(?:[:：]|是|为)\s*([-−]?\d[\d,._]*(?:\.\d+)?)\s*([%％]|万|亿|个|人|元|美元|天|小时|分钟|次|倍)?/gu;

function normalizeLabel(raw: string): string {
  return raw
    .replace(/[*_`#>]/g, '')
    .replace(/^[\s,.、，。;；:：-]+|[\s,.、，。;；:：-]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Same metric asserted with different values far apart in the answer. */
export function buildConsistencyCheck(assistantText: string): ReviewCheck | null {
  const text = stripCodeBlocks(assistantText);
  if (text.trim().length < 120) return null;

  type Hit = { value: string; index: number };
  const byKey = new Map<string, Hit[]>();

  for (const match of text.matchAll(LABELED_NUMBER_RE)) {
    const label = normalizeLabel(match[1]);
    if (label.length < 2 || GENERIC_LABEL_RE.test(label)) continue;
    const unit = match[3] || '';
    const value = match[2].replace(/[,_\s]/g, '').replace(/[−]/g, '-');
    const key = `${label}|${unit}`;
    const list = byKey.get(key) || [];
    list.push({ value, index: match.index ?? 0 });
    byKey.set(key, list);
  }

  const items: ReviewCheckItem[] = [];
  for (const [key, hits] of byKey) {
    if (hits.length < 2 || items.length >= 6) continue;
    const distinct = [...new Set(hits.map((h) => h.value))];
    if (distinct.length < 2) continue;
    // Adjacent mentions are usually an enumeration of variants, not a contradiction.
    const spread = Math.max(...hits.map((h) => h.index)) - Math.min(...hits.map((h) => h.index));
    if (spread < 200) continue;
    const [label, unit] = key.split('|');
    items.push({
      severity: 'warn',
      title: `"${label}" stated as ${distinct.slice(0, 3).join(' vs ')}${unit ? ` ${unit}` : ''}`,
      detail: 'The same metric carries different values in different parts of the answer.',
    });
  }

  const tracked = [...byKey.values()].filter((h) => h.length >= 2).length;
  if (!items.length && !tracked) return null;

  return {
    id: 'consistency',
    kind: 'consistency',
    status: 'done',
    clean: items.length === 0,
    summary: items.length
      ? `${items.length} internal contradiction(s)`
      : `${tracked} repeated metric(s) agree`,
    items,
  };
}

function shouldIncludeToolReceipt(
  phase: ReviewerPhase,
  findings: ReviewFinding[],
  record: ExecutionRecordEntry[],
): boolean {
  return phase === 'requested' || findings.length > 0 || record.length > 0;
}

/** Merge review checks across streaming updates (chronological, de-duped by kind). */
export function mergeReviewChecks(
  prev: ReviewCheck[],
  next: ReviewCheck[],
): ReviewCheck[] {
  const byKind = new Map<ReviewCheckKind, ReviewCheck>();
  for (const c of prev) byKind.set(c.kind, c);
  for (const c of next) byKind.set(c.kind, c);
  return REVIEWER_CHECK_KINDS.filter((k) => byKind.has(k)).map((k) => byKind.get(k)!);
}

/**
 * Checks that an LLM lens can deepen. Local scans always run first; a lens only
 * rides along in the single verifier call when the scheduler asks for it.
 */
export type ReviewLens = 'tool_receipt' | 'citation' | 'consistency' | 'completeness' | 'staleness' | 'code_quality';

const LENS_KINDS: ReviewLens[] = [
  'tool_receipt',
  'citation',
  'consistency',
  'completeness',
  'staleness',
  'code_quality',
];

export type ReviewPlan = {
  /** Local checks that actually fired, in display order. */
  checks: ReviewCheck[];
  /** Whether to spend the one allowed LLM verifier call. */
  llm: boolean;
  /** Lenses to include in that call — empty when llm is false. */
  lenses: ReviewLens[];
  /** Why the scheduler decided to spend (or skip) the LLM call. */
  reason: string;
};

/** Every local check is a cheap trigger: it returns null when it has nothing to audit. */
function runLocalChecks(input: ReviewInput): ReviewCheck[] {
  const checks: ReviewCheck[] = [];
  const push = (check: ReviewCheck | null) => {
    if (check) checks.push(check);
  };

  if (input.midTurn) {
    push(buildMidTurnCheck(input.midTurn.surfaces, input.midTurn.kind));
  }
  if (shouldIncludeToolReceipt(input.phase, input.findings, input.record)) {
    push(buildToolReceiptCheck(input.findings, input.record));
  }
  push(buildCitationCheck(input.assistantText, input.record));
  push(buildStalenessCheck(input.assistantText, input.record, input.now));
  push(buildRecalculationCheck(input.assistantText));
  push(buildConsistencyCheck(input.assistantText));
  push(buildCompletenessCheck(input));
  push(buildCodeQualityCheck(input.assistantText));
  push(buildVulnerabilityCheck(input.assistantText));

  const order = new Map(REVIEWER_CHECK_KINDS.map((k, i) => [k, i]));
  return checks.sort((a, b) => (order.get(a.kind) ?? 99) - (order.get(b.kind) ?? 99));
}

/**
 * Decide what to run. Local scans are free and self-gating; the LLM verifier is
 * capped at one call per audit and only spent when there is a reason to look
 * closer — an explicit review request, a mid-turn correction, or a local hit.
 */
export function planReviewChecks(input: ReviewInput): ReviewPlan {
  const checks = runLocalChecks(input);
  const localIssues = checks.reduce((n, c) => n + (c.items?.length || 0), 0);
  const fired = new Set(checks.map((c) => c.kind));

  const requested = input.phase === 'requested';
  let reason = 'no local signal — local checks only';
  let llm = false;
  if (requested) {
    llm = true;
    reason = 'user requested review — deep pass';
  } else if (input.findings.length) {
    llm = true;
    reason = `${input.findings.length} heuristic tool finding(s)`;
  } else if (input.midTurn) {
    llm = true;
    reason = 'mid-turn correction fired this turn';
  } else if (localIssues) {
    llm = true;
    reason = `${localIssues} local issue(s) worth a second opinion`;
  }

  const lenses: ReviewLens[] = [];
  if (llm) {
    for (const lens of LENS_KINDS) {
      if (lens === 'tool_receipt') {
        if (input.record.length || input.findings.length) lenses.push(lens);
        continue;
      }
      // Deep pass considers any applicable lens; auto pass only deepens hits.
      if (!fired.has(lens)) continue;
      const check = checks.find((c) => c.kind === lens);
      if (requested || (check?.items?.length || 0) > 0) lenses.push(lens);
    }
    if (!lenses.length) {
      llm = false;
      reason = 'no lens applies — local checks only';
    }
  }

  return { checks, llm, lenses, reason };
}

export function buildReviewReport(
  input: ReviewInput,
  status: ReviewReport['status'] = 'done',
  lensFindings: LensFinding[] = [],
): ReviewReport {
  const checks = applyLensFindings(runLocalChecks(input), lensFindings);
  return { phase: input.phase, status, checks };
}

/** One finding from an LLM lens, attributed to the check it belongs to. */
export type LensFinding = {
  lens: ReviewLens;
  severity: 'error' | 'warn';
  title: string;
  detail: string;
};

const LENS_DEFAULT_SUMMARY: Record<ReviewLens, string> = {
  tool_receipt: 'Verifier flagged tool-usage issues',
  citation: 'Verifier flagged citation issues',
  consistency: 'Verifier found contradictions',
  completeness: 'Verifier found gaps',
  staleness: 'Verifier flagged freshness risks',
  code_quality: 'Verifier flagged correctness issues',
};

/** Fold LLM lens findings into the local checks (creating a check if needed). */
export function applyLensFindings(
  checks: ReviewCheck[],
  lensFindings: LensFinding[],
): ReviewCheck[] {
  if (!lensFindings.length) return checks;

  const byKind = new Map<ReviewCheckKind, ReviewCheck>(checks.map((c) => [c.kind, { ...c, items: [...c.items] }]));

  for (const finding of lensFindings) {
    const kind = finding.lens as ReviewCheckKind;
    if (!REVIEWER_CHECK_KINDS.includes(kind)) continue;
    let check = byKind.get(kind);
    if (!check) {
      check = {
        id: kind,
        kind,
        status: 'done',
        clean: false,
        summary: LENS_DEFAULT_SUMMARY[finding.lens],
        items: [],
      };
      byKind.set(kind, check);
    }
    const duplicate = check.items.some(
      (i) => i.title.trim().toLowerCase() === finding.title.trim().toLowerCase(),
    );
    if (duplicate || check.items.length >= 12) continue;
    check.items.push({
      severity: finding.severity,
      title: finding.title,
      detail: finding.detail,
    });
  }

  const order = new Map(REVIEWER_CHECK_KINDS.map((k, i) => [k, i]));
  return [...byKind.values()]
    .map((check) => {
      const issues = check.items.length;
      if (!issues) return check;
      // Local summary said "clean" before the lens spoke — restate it.
      if (check.clean !== false) {
        return {
          ...check,
          clean: false,
          summary: `${issues} issue(s) after verifier review`,
        };
      }
      return check;
    })
    .sort((a, b) => (order.get(a.kind) ?? 99) - (order.get(b.kind) ?? 99));
}

export function emitReviewReport(
  send: (payload: Record<string, unknown>) => void,
  report: ReviewReport,
  targetMessageId?: string,
): void {
  send({
    reviewer_report: {
      ...report,
      ...(targetMessageId ? { targetMessageId } : {}),
    },
  });
}

export function emitReviewerFindings(
  send: (payload: Record<string, unknown>) => void,
  opts: {
    phase: ReviewerPhase;
    findings: ReviewFinding[];
    targetMessageId?: string;
  },
): void {
  send({
    reviewer_findings: {
      phase: opts.phase,
      findings: opts.findings,
      ...(opts.targetMessageId ? { targetMessageId: opts.targetMessageId } : {}),
    },
  });
}

function emitFindingsUi(
  send: (payload: Record<string, unknown>) => void,
  findings: ReviewFinding[],
  phase: ReviewerPhase,
  targetMessageId?: string,
  assistantText = '',
  record: ExecutionRecordEntry[] = [],
  midTurn?: MidTurnCorrection | null,
): void {
  const report = buildReviewReport({
    assistantText,
    record,
    findings,
    phase,
    midTurn,
  });
  if (!report.checks.length) return;
  emitReviewReport(send, report, targetMessageId);
  if (findings.length) {
    emitReviewerFindings(send, { phase, findings, targetMessageId });
  }
}

/** Heuristic-only audit (mid-turn / soft post-audit without LLM cost). */
export function runClaimAudit(
  send: (payload: Record<string, unknown>) => void,
  assistantText: string,
  record: ExecutionRecordEntry[],
  opts: { searchEnabled: boolean; integrations: string[]; skillCreator?: boolean },
  phase: ReviewerPhase,
  targetMessageId?: string,
  midTurn?: MidTurnCorrection | null,
): ReviewFinding[] {
  const findings = synthesizeFindings(assistantText, record, opts);
  emitFindingsUi(send, findings, phase, targetMessageId, assistantText, record, midTurn);
  return findings;
}

const VALID_SURFACES = new Set<string>([
  'notion',
  'github',
  'gmail',
  'calendar',
  'drive',
  'web_search',
  'web_read',
  'save_skill',
]);

const VALID_VERDICTS = new Set<string>([
  'pending_intent',
  'unsupported',
  'tool_failed',
  'no_receipt',
]);

/** Isolated verifier — no chat history, no tools, no persona. */
export const VERIFIER_SYSTEM_PROMPT = [
  'You are an independent claim verifier. You are NOT the assistant that wrote the answer.',
  'You only compare ASSISTANT TEXT against EXECUTION RECORD (tool receipts).',
  'Do not invent tools that are not in the record. Do not trust the assistant narrative.',
  'Output ONLY valid JSON (no markdown fences) with this shape:',
  '{"findings":[{"severity":"error"|"warn","surface":"notion"|"github"|"gmail"|"calendar"|"drive"|"web_search"|"web_read"|"save_skill","verdict":"pending_intent"|"unsupported"|"tool_failed"|"no_receipt","claim":"short quote or paraphrase","evidence":"which receipt contradicts or is missing"}],"summary":"one sentence"}',
  'Rules:',
  '- pending_intent: announced they would call a tool but record has no matching call.',
  '- no_receipt: claimed success/search result but no matching successful receipt.',
  '- tool_failed: claimed success but matching tool failed.',
  '- unsupported: claim is weakly tied to receipts (use sparingly as warn).',
  '- Do not duplicate pure URL-list mismatches (a separate citation check covers those). Focus on whether narrated actions/results match receipts.',
  '- If everything checks out, return {"findings":[],"summary":"All checked claims match receipts."}.',
  '- Prefer fewer high-confidence findings over speculative ones.',
].join('\n');

/** Per-lens instructions, injected only for the lenses the scheduler picked. */
const LENS_INSTRUCTIONS: Record<ReviewLens, string> = {
  tool_receipt:
    '- tool_receipt: narrated actions/results that no receipt supports (beyond the `findings` array above).',
  citation:
    '- citation: a cited URL missing from `sources=`, or a figure attributed to a source whose snippet does not contain it.',
  consistency:
    '- consistency: the answer contradicting itself — same metric with different values, a conclusion that reverses an earlier statement, steps that do not follow from each other.',
  completeness:
    '- completeness: the answer not covering what USER ASK requested, promising follow-up it never delivers, or listing fewer items than it announced.',
  staleness:
    '- staleness: present-tense claims ("currently", "latest") that rest on nothing recent, or a stated cutoff older than the sources.',
  code_quality:
    '- code_quality: logic/API bugs in the proposed code that are NOT security issues (wrong bounds, missing await, wrong types, dead branches).',
};

/** Build the verifier system prompt for exactly the lenses requested. */
export function buildVerifierSystemPrompt(lenses: ReviewLens[]): string {
  const extra = lenses.filter((l) => l !== 'tool_receipt');
  if (!extra.length) return VERIFIER_SYSTEM_PROMPT;
  return [
    VERIFIER_SYSTEM_PROMPT,
    '',
    'Additionally review the answer through these lenses and report them in a separate `lens` array:',
    `{"lens":[{"lens":${extra.map((l) => `"${l}"`).join('|')},"severity":"error"|"warn","title":"short label","detail":"why it is a problem"}]}`,
    ...extra.map((l) => LENS_INSTRUCTIONS[l]),
    '- Only report lens issues you can point at concretely in the text. Empty array when clean.',
    '- Never repeat the same issue in both `findings` and `lens`.',
  ].join('\n');
}

export function formatExecutionRecordForVerifier(record: ExecutionRecordEntry[]): string {
  if (!record.length) return '(empty — no tools ran in this turn)';
  return record
    .map((e, i) => {
      const bits = [`${i + 1}. tool=${e.tool}`, `ok=${e.ok}`];
      if (e.provider) bits.push(`provider=${e.provider}`);
      if (e.query) bits.push(`query=${e.query.slice(0, 120)}`);
      if (e.error) bits.push(`error=${e.error.slice(0, 200)}`);
      if (e.urls?.length) bits.push(`urls=${e.urls.slice(0, 8).join(' ')}`);
      if (e.sources?.length) {
        const preview = e.sources
          .slice(0, 4)
          .map((s) => {
            const t = (s.title || '').slice(0, 60);
            const sn = (s.snippet || '').slice(0, 80);
            return t || sn ? `${s.url}「${t}${sn && t ? ' · ' : ''}${sn}」` : s.url;
          })
          .join(' ; ');
        bits.push(`sources=${preview}`);
      }
      return bits.join(' | ');
    })
    .join('\n');
}

export function buildVerifierUserPrompt(
  assistantText: string,
  record: ExecutionRecordEntry[],
  userAsk = '',
): string {
  const text = String(assistantText || '').trim().slice(0, 8000);
  const ask = String(userAsk || '').trim().slice(0, 1200);
  return [
    '## EXECUTION RECORD',
    formatExecutionRecordForVerifier(record),
    ...(ask ? ['', '## USER ASK', ask] : []),
    '',
    '## ASSISTANT TEXT TO AUDIT',
    text || '(empty)',
  ].join('\n');
}

export type VerifierResult = {
  findings: ReviewFinding[];
  lens: LensFinding[];
};

function extractJsonObject(raw: string): string {
  const text = String(raw || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

export function parseVerifierResponse(raw: string, allowedLenses: ReviewLens[] = []): VerifierResult {
  const text = String(raw || '').trim();
  if (!text) return { findings: [], lens: [] };
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as {
      findings?: Array<Record<string, unknown>>;
      lens?: Array<Record<string, unknown>>;
    };
    const out: ReviewFinding[] = [];
    const seen = new Set<string>();
    for (const f of parsed.findings || []) {
      const surface = String(f.surface || '').trim().toLowerCase();
      const verdict = String(f.verdict || '').trim().toLowerCase();
      if (!VALID_SURFACES.has(surface) || !VALID_VERDICTS.has(verdict)) continue;
      const severity = f.severity === 'warn' ? 'warn' : 'error';
      const claim = String(f.claim || '').trim().slice(0, 400);
      const evidence = String(f.evidence || '').trim().slice(0, 500);
      if (!claim) continue;
      const id = findingId(surface as FakedToolSurface, verdict as ReviewFindingVerdict);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        severity,
        surface: surface as FakedToolSurface,
        verdict: verdict as ReviewFindingVerdict,
        claim,
        evidence: evidence || 'See execution record.',
      });
    }

    const allowed = new Set<string>(allowedLenses);
    const lens: LensFinding[] = [];
    for (const l of parsed.lens || []) {
      const kind = String(l.lens || '').trim().toLowerCase();
      if (!allowed.has(kind)) continue;
      const title = String(l.title || '').trim().slice(0, 200);
      if (!title) continue;
      lens.push({
        lens: kind as ReviewLens,
        severity: l.severity === 'error' ? 'error' : 'warn',
        title,
        detail: String(l.detail || '').trim().slice(0, 400) || 'Flagged by independent verifier.',
      });
      if (lens.length >= 12) break;
    }

    return { findings: out, lens };
  } catch {
    return { findings: [], lens: [] };
  }
}

export function mergeFindings(...groups: ReviewFinding[][]): ReviewFinding[] {
  const byId = new Map<string, ReviewFinding>();
  for (const group of groups) {
    for (const f of group) {
      const prev = byId.get(f.id);
      if (!prev) {
        byId.set(f.id, f);
        continue;
      }
      // Prefer error over warn; prefer longer (usually LLM) claim text.
      const severity = prev.severity === 'error' || f.severity === 'error' ? 'error' : 'warn';
      const prefer = f.claim.length >= prev.claim.length ? f : prev;
      byId.set(f.id, { ...prefer, severity });
    }
  }
  return [...byId.values()];
}

export type LlmCompleteFn = (messages: Array<{ role: string; content: string }>) => Promise<string>;

/**
 * Independent LLM verifier — exactly one call, carrying only the lenses the
 * scheduler selected. Failures fall back to empty (caller keeps heuristics).
 */
export async function runLlmVerifier(
  assistantText: string,
  record: ExecutionRecordEntry[],
  complete: LlmCompleteFn,
  lenses: ReviewLens[] = [],
  userAsk = '',
): Promise<VerifierResult> {
  if (!String(assistantText || '').trim()) return { findings: [], lens: [] };
  try {
    const raw = await complete([
      { role: 'system', content: buildVerifierSystemPrompt(lenses) },
      { role: 'user', content: buildVerifierUserPrompt(assistantText, record, userAsk) },
    ]);
    return parseVerifierResponse(raw, lenses);
  } catch (err) {
    console.warn('claim verifier LLM failed', err);
    return { findings: [], lens: [] };
  }
}

/**
 * Full audit. Local checks are free and self-gating; the scheduler decides
 * whether the single LLM verifier call is worth spending, and which lenses ride
 * along in it. Returns the report + flattened issues so the main model can repair.
 */
export async function runFullClaimAudit(
  send: (payload: Record<string, unknown>) => void,
  assistantText: string,
  record: ExecutionRecordEntry[],
  opts: { searchEnabled: boolean; integrations: string[]; skillCreator?: boolean },
  phase: ReviewerPhase,
  complete: LlmCompleteFn | null,
  options?: {
    forceLlm?: boolean;
    targetMessageId?: string;
    emitEmpty?: boolean;
    midTurn?: MidTurnCorrection | null;
    userAsk?: string;
    truncated?: boolean;
    finishReason?: string | null;
    /** Abort mid-audit / mid-verifier when the user sends a new message. */
    signal?: AbortSignal;
  },
): Promise<ClaimAuditResult> {
  const throwIfAborted = () => {
    if (options?.signal?.aborted) {
      const err = new Error('Review aborted');
      err.name = 'AbortError';
      throw err;
    }
  };
  throwIfAborted();

  const heuristic = synthesizeFindings(assistantText, record, opts);
  const input: ReviewInput = {
    assistantText,
    record,
    findings: heuristic,
    phase,
    midTurn: options?.midTurn,
    userAsk: options?.userAsk,
    truncated: options?.truncated,
    finishReason: options?.finishReason,
  };

  const plan = planReviewChecks(input);
  let llmFindings: ReviewFinding[] = [];
  let lensFindings: LensFinding[] = [];

  const spendLlm = Boolean(complete) && (plan.llm || Boolean(options?.forceLlm));
  if (spendLlm && complete) {
    throwIfAborted();
    const lenses = plan.lenses.length
      ? plan.lenses
      : record.length
        ? (['tool_receipt'] as ReviewLens[])
        : [];
    const lensSet = new Set<ReviewLens>(lenses);
    const runningChecks = plan.checks.map((check) =>
      lensSet.has(check.kind as ReviewLens)
        ? { ...check, status: 'running' as ReviewCheckStatus, summary: 'Running independent verifier…' }
        : check,
    );
    if (runningChecks.length) {
      emitReviewReport(
        send,
        { phase, status: 'running', checks: runningChecks },
        options?.targetMessageId,
      );
    }
    const result = await runLlmVerifier(
      assistantText,
      record,
      complete,
      lenses,
      options?.userAsk,
    );
    throwIfAborted();
    llmFindings = result.findings;
    lensFindings = result.lens;
  }

  const findings = mergeFindings(heuristic, llmFindings);
  const report = buildReviewReport({ ...input, findings }, 'done', lensFindings);
  if (report.checks.length || options?.emitEmpty) {
    if (report.checks.length) {
      emitReviewReport(send, report, options?.targetMessageId);
      if (findings.length) {
        emitReviewerFindings(send, {
          phase,
          findings,
          targetMessageId: options?.targetMessageId,
        });
      }
    }
  }
  return { findings, report, issues: collectReviewIssues(report) };
}

/** One actionable issue from any Review check — fed to the main model for repair. */
export type ReviewIssue = {
  kind: ReviewCheckKind;
  severity: 'error' | 'warn';
  title: string;
  detail: string;
};

export function collectReviewIssues(report: ReviewReport): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  for (const check of report.checks || []) {
    for (const item of check.items || []) {
      issues.push({
        kind: check.kind,
        severity: item.severity,
        title: item.title,
        detail: item.detail,
      });
    }
  }
  return issues;
}

export type ClaimAuditResult = {
  findings: ReviewFinding[];
  report: ReviewReport;
  issues: ReviewIssue[];
};

/** Prompt for the main model to address verifier findings (request review / auto-correct). */
export function buildFindingsResponsePrompt(
  findings: ReviewFinding[],
  assistantText?: string,
): string {
  if (!findings.length) {
    return [
      'Independent claim review found no unsupported tool claims against the execution record.',
      'Reply briefly confirming the previous answer is consistent with tool receipts.',
      'Do not invent new tool actions. Do not call tools.',
    ].join(' ');
  }
  const list = findings
    .map(
      (f, i) =>
        `${i + 1}. [${f.severity}/${f.verdict}/${f.surface}] claim: ${f.claim}\n   evidence: ${f.evidence}`,
    )
    .join('\n');
  const excerpt = String(assistantText || '').trim().slice(0, 2000);
  return [
    'Independent claim review produced the following findings against tool receipts.',
    'Address each finding honestly: retract unsupported claims, acknowledge tool failures, or state what was NOT done.',
    'Be brief. Do not invent notion.so / github.com / google.com links. Do not call tools.',
    '',
    '## Findings',
    list,
    excerpt ? `\n## Prior answer excerpt\n${excerpt}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Prompt covering every Review check issue (验算 / 引用 / 完整性 / …), not only tool receipts. */
export function buildReviewIssuesResponsePrompt(
  issues: ReviewIssue[],
  assistantText?: string,
): string {
  if (!issues.length) {
    return [
      'Automatic review found no issues in the previous answer.',
      'Reply briefly confirming the answer stands. Do not call tools.',
    ].join(' ');
  }
  const list = issues
    .map(
      (issue, i) =>
        `${i + 1}. [${issue.severity}/${issue.kind}] ${issue.title}\n   ${issue.detail}`,
    )
    .join('\n');
  const excerpt = String(assistantText || '').trim().slice(0, 2400);
  return [
    'Automatic review finished and found issues in the previous answer.',
    'Revise the answer to address each issue below.',
    'Rules:',
    '- Fix arithmetic, retract unsupported citations/claims, fill gaps, or correct unsafe/buggy code as needed.',
    '- Prefer a corrected final answer over a meta commentary about the review.',
    '- Do not invent tool actions, URLs, or receipts that were never returned.',
    '- Do not call tools in this correction turn.',
    '',
    '## Review issues',
    list,
    excerpt ? `\n## Prior answer excerpt\n${excerpt}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export const FINDINGS_RESPONSE_SYSTEM = [
  'You are responding to an automatic review report on your previous answer.',
  'Produce a corrected reply that fixes the listed issues.',
  'Be concise and honest. Prefer retracting or fixing over defending unsupported claims.',
  'Do not call tools. Do not invent URLs or tool payloads.',
].join(' ');

/** SSE tool row so the Reviewer appears in Process. */
export function emitReviewerStep(
  send: (payload: Record<string, unknown>) => void,
  opts: {
    status: 'start' | 'done';
    phase: ReviewerPhase;
    surfaces?: FakedToolSurface[];
    error?: string;
    /** success = claimed done; intent = announced then stopped */
    kind?: 'success' | 'intent';
  },
): void {
  const surfaces = opts.surfaces || [];
  const labels = surfaces.map((s) =>
    opts.kind === 'intent' ? INTENT_LABELS[s] : SURFACE_LABELS[s],
  );
  send({
    tool: {
      name: 'claim_reviewer',
      status: opts.status,
      provider: 'claim-reviewer',
      query:
        opts.phase === 'audit'
          ? 'post-audit'
          : opts.phase === 'requested'
            ? 'requested review'
            : labels.length
              ? labels.join(', ')
              : 'auto review',
      error: opts.error,
      results:
        opts.status === 'done'
          ? [
              {
                title:
                  opts.phase === 'requested'
                    ? 'Independent claim review'
                    : opts.phase === 'audit'
                      ? 'Post-audit: claims without tool receipts'
                      : opts.kind === 'intent'
                        ? 'Announced tools without tool_calls'
                        : 'Narrated tool success without tool_calls',
                url: '',
                snippet: labels.join(', ') || (opts.phase === 'requested' ? 'clean' : 'none'),
              },
            ]
          : undefined,
    },
  });
}
