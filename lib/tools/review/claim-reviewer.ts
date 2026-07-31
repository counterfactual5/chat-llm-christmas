/**
 * Claim Reviewer — single layer that catches narrated tool successes without
 * real tool_calls (mid-turn correction + post-audit). Product capability, not
 * MCP, not a model-callable tool.
 *
 * Reviewer v2 borrows from foundry-research (evidence units + claim verdicts)
 * and OpenScience (strength-graded findings, L0/L1 gate). Citation checks go
 * through `lib/review/evidence.ts` — blurbs cannot prove a figure wrong.
 */

import {
  buildEvidenceIndex,
  citeEvidence,
  collectEvidenceUnits,
  extractEvidenceFromPayload,
  factAppearsIn,
  getReviewGateLevel,
  gradeClaimGap,
  haystackFor,
  makeEvidenceUnit,
  strongestFor,
  type ClaimVerdict,
  type EvidenceStrength,
  type EvidenceUnit,
} from '@/lib/tools/review/evidence';

export { getReviewGateLevel } from '@/lib/tools/review/evidence';
export type { ClaimVerdict, EvidenceStrength, EvidenceUnit, ReviewGateLevel } from '@/lib/tools/review/evidence';

export type FakedToolSurface =
  | 'notion'
  | 'github'
  | 'gmail'
  | 'calendar'
  | 'drive'
  | 'web_search'
  | 'web_read'
  | 'save_skill'
  | 'create_file';

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
    // Require Notion signal — bare「更新页面」in generic docs talk is too common.
    if (claimsWrite && (hasNotionUrl || /Notion|notion\.so/i.test(t))) found.push('notion');
  }

  if (set.has('github')) {
    const claimsWrite =
      /(已(经)?(创建|提交|打开|评论)|正在(创建|提交|打开|评论)).{0,12}(issue|PR|pull request|拉取请求)|created (an? )?(issue|PR|pull request)|opened (an? )?(PR|pull request)|commented on (the )?(issue|PR)/i.test(
        t,
      );
    // Do NOT flag mere github.com links that mention issue/PR in ordinary discussion.
    if (claimsWrite) found.push('github');
  }

  if (set.has('gmail')) {
    if (
      /(已(经)?(发送|回复|转发)|正在发送).{0,8}(邮件|邮箱|gmail)|sent (the )?(email|mail)|replied to/i.test(t) ||
      (/mail\.google\.com/i.test(t) && /(已(经)?(发送|回复)|正在发送|sent |replied )/i.test(t))
    ) {
      found.push('gmail');
    }
  }

  if (set.has('calendar')) {
    if (
      /(已(经)?(创建|添加|安排)|正在(创建|添加)).{0,10}(日程|日历|会议|event)|created (a )?(calendar )?event|scheduled (a )?(meeting|event)/i.test(
        t,
      ) ||
      (/calendar\.google\.com/i.test(t) &&
        /(已(经)?(创建|添加|安排)|正在(创建|添加)|created |scheduled )/i.test(t))
    ) {
      found.push('calendar');
    }
  }

  if (set.has('drive')) {
    if (
      /(已(经)?(上传|创建|分享)|正在(上传|创建)).{0,10}(文件|文档|Drive|网盘)|uploaded (a )?file|created (a )?doc/i.test(
        t,
      ) ||
      (/drive\.google\.com/i.test(t) &&
        /(已(经)?(上传|创建|分享)|正在(上传|创建)|uploaded |created )/i.test(t))
    ) {
      found.push('drive');
    }
  }

  if (opts.searchEnabled) {
    if (
      /(根据(联网)?搜索|搜索(结果|显示|表明)|检索到)|according to (my |the )?(web )?search|I found the following links/i.test(
        t,
      ) &&
      /https?:\/\//i.test(t)
    ) {
      found.push('web_search');
    }
    // Require first-person “I read” — 「根据该页」alone is normal when citing a user-pasted URL.
    if (
      /(我(已经|已)?(读完|阅读完|抓取了|打开并读了)|I (have )?read (the )?(page|article)|according to the page I (just )?read)/i.test(
        t,
      ) &&
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

  // Deliverable file claims — not “生成了文件说明/文件结构” pedagogy.
  if (
    /(create_file|local:\/\/|文件卡片|已(经)?(用工具)?(生成|创建|写入|保存).{0,16}(\.md|\.py|\.ts|\.tsx|\.js|\.json|\.txt)|created (the )?file|saved (the )?file|wrote (the )?file to)/i.test(
      t,
    )
  ) {
    found.push('create_file');
  }

  return found;
}

/**
 * Detect “I'll fetch/read/update first…” narration with no tool_calls.
 * Different from success-claims: the model announces intent then stops.
 *
 * Keep these tight: mid-turn correction forces another round, so false
 * positives derail ordinary explanations (especially with Notion connected).
 */
export function detectPendingToolIntent(
  text: string,
  opts: { searchEnabled: boolean; integrations: string[] },
): FakedToolSurface[] {
  const t = String(text || '');
  if (!t.trim()) return [];
  // Meta talk about searching (why search / don't need search) is not an intent to call.
  const skipWebIntent =
    /(不(用|需要|该|必|再)(去)?(搜索|联网|搜)|基础知识|知识库(里面)?都有|为什么(还)?要(搜索|搜)|认知校准|搜索不到|搜不到)/i.test(
      t,
    ) && !/(正在(联网)?搜索|立即(执行)?搜索|马上搜索|I('ll| will) search now)/i.test(t);

  const set = new Set(
    (opts.integrations || []).map((id) => String(id || '').trim().toLowerCase()),
  );
  const found: FakedToolSurface[] = [];

  if (set.has('notion')) {
    const notionCtx = /Notion|notion\.so|notion\.site|(当前)?页面|工作区|workspace/i.test(t);
    const intendsNotion =
      notionCtx &&
      /(先(读|看|获取|拉取|打开)|让我(先)?(读|看|获取|拉取)|我(先|来)(读|看|获取).{0,16}(页面|内容|Notion)|读一下(当前)?(页面|内容)|看一下(当前)?页面|fetch (the )?(current )?(page|content)|let me (first )?(fetch|read|get|load).{0,24}(page|notion)|I('ll| will) (first )?(fetch|read|get).{0,24}(page|notion)|正在(读取|获取|拉取).{0,12}(页面|内容|Notion)|然后重写|then (rewrite|update)|重写——|重写—)/i.test(
        t,
      );
    if (intendsNotion) found.push('notion');
  }

  if (opts.searchEnabled && !skipWebIntent) {
    // Clear live-web intent only. Avoid bare「我搜索不到」/「查清区别」.
    if (
      /(先.{0,8}(联网|上网)?(搜索|搜一下)|让我(去)?(联网|上网)?(搜索|搜一下)|我来(联网|上网)?(搜索|搜一下)|正在(联网|上网)?搜索|我(将|会)(立即|马上)?(去)?(执行)?搜索|联网查一下|上网查一下|I'll (go )?(and )?search|let me search|searching (the )?(web|internet)|look\s*up (online|on the web))/i.test(
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
      /(先(看|读|获取).{0,12}(仓库|repo|issue|PR)|let me (check|fetch|read).{0,12}(repo|issue|PR|pull)|我(先|来)(看|读|获取).{0,12}(仓库|repo|issue|PR))/i.test(
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
  create_file: 'create_file',
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
  create_file: 'create_file',
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
  const webOnly = surfaces.every((s) => s === 'web_search' || s === 'web_read');
  if (webOnly) {
    return [
      `You announced you would use tools (${list}) but you did not emit any tool_calls in THIS turn.`,
      'Choose ONE now:',
      '(A) If the live web is actually needed — emit real API tool_calls immediately (no more narration-only).',
      '(B) If this is stable knowledge you already know (definitions, textbook facts, “which field”) — retract the search announcement and answer directly from knowledge. Do NOT invent a pointless web_search.',
      'Do not claim you already searched until tools return results.',
    ].join(' ');
  }
  return [
    `You announced you would use tools (${list}) but you did not emit any tool_calls in THIS turn — the reply stopped after the announcement.`,
    'Stop narrating. Immediately emit real API tool_calls now,',
    'OR clearly retract and say you will not call those tools.',
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
  /**
   * Evidence units for claim verification (may include full web_read body).
   * Built at receipt time so citation checks can judge by evidence strength.
   */
  evidence?: EvidenceUnit[];
};

type ClientToolRun = {
  name: string;
  status: string;
  query?: string;
  error?: string;
  provider?: string;
  results?: Array<{ url?: string; title?: string; snippet?: string; body?: string }>;
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
  create_file: [/create_file/i],
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
  const byKey = new Map<string, ExecutionSource>();
  const push = (raw: { url?: unknown; title?: unknown; snippet?: unknown }) => {
    const url = trimUrlTail(String(raw.url || ''));
    if (!/^https?:\/\//i.test(url)) return;
    const key = normalizeUrl(url);
    if (!key) return;
    const title = String(raw.title || '').trim().slice(0, 200) || undefined;
    const snippet = String(raw.snippet || '').trim().slice(0, 500) || undefined;
    const prev = byKey.get(key);
    if (!prev) {
      const hit = { url, title, snippet };
      byKey.set(key, hit);
      sources.push(hit);
      return;
    }
    // Same URL may appear as a bare link first, then again with title/snippet —
    // keep the richest fields so citation checks see headlines, not empty husks.
    if ((title || '').length > String(prev.title || '').length) prev.title = title;
    if ((snippet || '').length > String(prev.snippet || '').length) prev.snippet = snippet;
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
export function buildExecutionRecordFromMessages(
  messages: ChatMessageLike[],
  opts?: {
    /**
     * Only include tool receipts that appear AFTER this message index.
     * Used by Auto-review so historical replayed tools do not pollute
     * the current turn's audit.
     */
    afterIndex?: number;
  },
): ExecutionRecordEntry[] {
  const start = Math.max(0, (opts?.afterIndex ?? -1) + 1);
  const pending = new Map<string, string>();
  const entries: ExecutionRecordEntry[] = [];

  for (let i = start; i < messages.length; i++) {
    const m = messages[i];
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
      const evidence = extractEvidenceFromPayload(name, payload);
      const urls = sources.map((s) => s.url);
      entries.push({
        tool: name,
        ok: !failed,
        error: failed ? extractErrorSnippet(payload) : undefined,
        ...(urls.length ? { urls } : {}),
        ...(sources.length ? { sources } : {}),
        ...(evidence.length ? { evidence } : {}),
      });
    }
  }
  return entries;
}

/** Index of the last user message — Auto-review turn boundary. */
export function lastUserMessageIndex(messages: ChatMessageLike[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return i;
  }
  return -1;
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
      // Prefer persisted full-page body (web_read) over short UI snippets.
      const evidence = (r.results || []).flatMap((x, i) => {
        const url = trimUrlTail(String(x?.url || ''));
        if (!/^https?:\/\//i.test(url)) return [];
        const body = String(x?.body || '').trim();
        if (body.length > 600 || (/web_read|web-read|read_url/i.test(r.name) && body)) {
          return [
            makeEvidenceUnit({
              index: i,
              url,
              title: String(x?.title || '').trim() || undefined,
              text: body,
              kind: 'body',
              tool: String(r.name || 'web_read'),
            }),
          ];
        }
        const blurb = String(x?.snippet || x?.title || '').trim();
        if (!blurb) return [];
        return [
          makeEvidenceUnit({
            index: i,
            url,
            title: String(x?.title || '').trim() || undefined,
            text: blurb,
            kind: 'blurb',
            tool: String(r.name || 'unknown'),
          }),
        ];
      });
      const urls = sources.map((s) => s.url);
      return {
        tool: String(r.name || 'unknown'),
        provider: r.provider,
        ok: !r.error,
        error: r.error,
        query: r.query,
        ...(urls.length ? { urls } : {}),
        ...(sources.length ? { sources } : {}),
        ...(evidence.length ? { evidence } : {}),
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

/** Drop surfaces that already have a successful receipt in this turn. */
export function filterSurfacesMissingReceipt(
  surfaces: FakedToolSurface[],
  record: ExecutionRecordEntry[],
): FakedToolSurface[] {
  return surfaces.filter((s) => !hasSuccessfulTool(record, s));
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

/** Freshness only follows live web lookup — not image understand / Notion / etc. */
function hasWebSearchOrReadReceipt(record: ExecutionRecordEntry[]): boolean {
  return record.some(
    (e) =>
      e.ok &&
      /^(web_search|web_read|web-read|proactive_search|read_url)$/i.test(
        String(e.tool || '').trim(),
      ),
  );
}

function collectSources(record: ExecutionRecordEntry[]): ExecutionSource[] {
  const out: ExecutionSource[] = [];
  const byKey = new Map<string, ExecutionSource>();
  for (const entry of record) {
    const hits: ExecutionSource[] =
      entry.sources?.length
        ? entry.sources
        : (entry.urls || []).map((url) => ({ url }));
    for (const hit of hits) {
      const key = normalizeUrl(hit.url);
      if (!key) continue;
      const prev = byKey.get(key);
      if (!prev) {
        const copy = {
          url: hit.url,
          title: hit.title,
          snippet: hit.snippet,
        };
        byKey.set(key, copy);
        out.push(copy);
        continue;
      }
      if (String(hit.title || '').length > String(prev.title || '').length) {
        prev.title = hit.title;
      }
      if (String(hit.snippet || '').length > String(prev.snippet || '').length) {
        prev.snippet = hit.snippet;
      }
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

/** Title + snippet + URL slug — never the full article (unless web_read stored it). */
function sourceText(source: ExecutionSource): string {
  let path = '';
  try {
    path = decodeURIComponent(new URL(source.url).pathname || '');
  } catch {
    path = source.url || '';
  }
  return [source.title, source.snippet, path].filter(Boolean).join(' ');
}

function clauseBefore(text: string, idx: number, lookback = 120): string {
  let before = text.slice(Math.max(0, idx - lookback), idx);
  // Lookback often starts mid-word / mid-`**bold**` — advance to a boundary so
  // Review titles don't show as "ek V4**，…".
  if (idx > lookback) {
    const boundary = before.search(/[\s\n。！？、，,;；:：]/);
    if (boundary > 0 && boundary < before.length - 8) {
      before = before.slice(boundary + 1);
    }
  }
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
 * Markdown images `![alt](url)` are illustrations, not citations — skipped.
 */
export function extractCitationAnchors(assistantText: string): CitationAnchor[] {
  const text = stripCodeBlocks(assistantText);
  if (!text.trim()) return [];

  const anchors: CitationAnchor[] = [];
  const seen = new Set<string>();
  // Image targets are not citations, but must still be excluded from bare-URL pickup.
  const covered = new Set<string>();

  const push = (url: string, claim: string) => {
    const host = hostOf(url);
    if (!host || NON_CITATION_HOST_RE.test(host)) return;
    const key = `${normalizeUrl(url)}|${claim.slice(0, 80)}`;
    if (seen.has(key)) return;
    seen.add(key);
    anchors.push({ url: trimUrlTail(url), claim: claim.replace(/\s+/g, ' ').trim().slice(0, 280) });
  };

  // Markdown links: [label](url) — claim = surrounding clause (before + after) + label.
  // Skip `![alt](url)` images (the `!` sits immediately before `[`).
  const mdLinkRe = /\[([^\]]{1,120})\]\((https?:\/\/[^)\s]+)\)/g;
  for (const match of text.matchAll(mdLinkRe)) {
    const label = match[1].trim();
    const url = match[2];
    const idx = match.index ?? 0;
    if (idx > 0 && text[idx - 1] === '!') {
      covered.add(normalizeUrl(url));
      continue;
    }
    const end = idx + match[0].length;
    const claim = [clauseBefore(text, idx), label, clauseAfter(text, end)]
      .filter(Boolean)
      .join(' — ');
    push(url, claim || label || url);
    covered.add(normalizeUrl(url));
  }

  // Bare URLs not already covered as markdown link/image targets.
  for (const a of anchors) covered.add(normalizeUrl(a.url));
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

/** Clean claim text for Review panel titles — strip markdown so `**bold**` doesn't
 *  render as broken `ek V4**` after truncation. */
export function formatReviewClaimTitle(claim: string, max = 140): string {
  const cleaned = String(claim || '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (cleaned.length <= max) return cleaned;
  const slice = cleaned.slice(0, max);
  const cut = Math.max(
    slice.lastIndexOf('，'),
    slice.lastIndexOf('。'),
    slice.lastIndexOf('、'),
    slice.lastIndexOf(' '),
    slice.lastIndexOf(','),
    slice.lastIndexOf('—'),
  );
  return `${(cut > max * 0.45 ? slice.slice(0, cut) : slice).trim()}…`;
}

export type CitationAudit = {
  checked: number;
  matched: number;
  unsupported: string[];
  /**
   * Claims whose hard facts do not appear in available evidence.
   * Verdict depends on evidence strength (Foundry + OpenScience):
   *  - unverifiable: only search blurbs — absence ≠ false
   *  - unsupported: full page body was read and still missing
   */
  unsupportedClaims: Array<{
    url: string;
    claim: string;
    missing: string[];
    verdict: ClaimVerdict;
    strength: EvidenceStrength;
    evidenceId?: string;
  }>;
};

/**
 * Citation audit against evidence units (not the live web).
 * (1) URL must appear in tool hits.
 * (2) Hard facts near the citation should appear in the strongest evidence
 *     for that URL. Blurb-only gaps → unverifiable; body gaps → unsupported.
 */
export function auditCitations(
  assistantText: string,
  record: ExecutionRecordEntry[],
): CitationAudit | null {
  if (!hasRetrievalReceipt(record)) return null;
  const sources = collectSources(record);
  if (!sources.length) return null;

  const units = collectEvidenceUnits(record);
  const index = buildEvidenceIndex(units.length ? units : collectEvidenceUnits(
    sources.map((s) => ({ sources: [s], tool: 'unknown' })),
  ), normalizeUrl);

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

    const best = strongestFor(index, key);
    const hay = haystackFor(index, key) || sourceText(source);
    if (!hay.trim()) continue; // URL-only receipt — can't verify content yet.

    const facts = extractFactualTokens(anchor.claim);
    if (facts.length < 1) continue;
    const missing = facts.filter((t) => !factAppearsIn(t, hay));
    if (!missing.length) continue;

    // Blurbs are partial — only flag distinctive figures (%, decimals, large nums).
    // Bare years (2026) almost never appear in a short search blurb even when the
    // article is about that year — only treat them as notable against full-page body.
    const strength: EvidenceStrength = best?.strength || 'weak';
    const notable = missing.filter((t) => {
      if (/^(?:19|20)\d{2}$/.test(String(t))) return strength === 'strong';
      if (/%/.test(t) || /\.\d/.test(t) || /,/.test(t)) return true;
      const n = Number(String(t).replace(/[^\d.]/g, ''));
      return Number.isFinite(n) && (n >= 100 || String(t).length >= 4);
    });
    if (!notable.length) continue;

    const graded = gradeClaimGap({ missing: notable, strength });
    // Confirmed shouldn't appear here; skip info-only.
    if (graded.verdict === 'confirmed') continue;

    unsupportedClaims.push({
      url: anchor.url,
      claim: anchor.claim,
      missing: notable.slice(0, 4),
      verdict: graded.verdict,
      strength,
      evidenceId: best?.id,
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

  const index = buildEvidenceIndex(collectEvidenceUnits(record), normalizeUrl);
  const items: ReviewCheckItem[] = [];
  for (const url of audit.unsupported.slice(0, 8)) {
    items.push({
      severity: 'warn',
      title: `Link not in tool results: ${url}`,
      detail:
        'This URL never appeared in any retrieval payload — unverifiable (no evidence unit). Verify it or remove it.',
    });
  }
  for (const row of audit.unsupportedClaims.slice(0, 8)) {
    const best = strongestFor(index, normalizeUrl(row.url));
    const evidenceNote = citeEvidence(best);
    const isStrong = row.verdict === 'unsupported' || row.verdict === 'contradicted';
    items.push({
      severity: isStrong ? 'error' : 'warn',
      title: formatReviewClaimTitle(row.claim) || row.url,
      detail: isStrong
        ? `[${row.verdict}/${row.strength}] Cited ${row.url}, but full-page evidence does not contain: ${row.missing.join(', ')}. Evidence: ${evidenceNote}.`
        : `[${row.verdict}/${row.strength}] Cited ${row.url}; available evidence (${evidenceNote}) does not contain: ${row.missing.join(', ')}. Absence from a search blurb is not proof the article is wrong — treat as unverified.`,
    });
  }

  const bits = [`${audit.matched}/${audit.checked} links in receipts`];
  const strongN = audit.unsupportedClaims.filter(
    (c) => c.verdict === 'unsupported' || c.verdict === 'contradicted',
  ).length;
  const weakN = audit.unsupportedClaims.length - strongN;
  if (strongN) bits.push(`${strongN} unsupported vs page body`);
  if (weakN) bits.push(`${weakN} unverifiable vs blurb`);

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
    // UI gets a short receipt list; the verifier prompt still uses the full dump.
    body: formatExecutionRecordForUi(record) || undefined,
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

/**
 * Labels that look like totals but are averages / weighted figures — summing
 * the column would false-positive (e.g. 「合计(均价)」).
 */
const NON_SUM_TOTAL_RE =
  /均价|均值|平均|加权|avg\b|average|mean|weighted|median|中位/i;

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

    const totalRows = body.filter((row) => {
      const label = row[0] || '';
      return TOTAL_ROW_RE.test(label) && !NON_SUM_TOTAL_RE.test(label);
    });
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

/**
 * "Here's the WRONG way to do it" teaching callouts (common in security
 * explainers / code review answers). Pattern-smell rules (injection, weak
 * hash, hardcoded-credential, …) should not fire when the surrounding text
 * is explicitly presenting the snippet as a bad example — only the specific,
 * hard-format secret leaks (aws-key/openai-key/…) skip this exemption, since
 * a real key pasted under an "example" label is still a real leak.
 */
const NEGATIVE_EXAMPLE_RE =
  /反例|错误(?:示例|写法|做法)|不(?:要|安全)(?:这样|的)|不推荐|bad\s*example|bad\s*practice|anti-?pattern|insecure\s*(?:example|code)|wrong\s*way|do\s*not\s*do\s*this|❌/i;

/** These are unambiguous secret formats — a "示例/example" caption doesn't make a real key safe. */
const HARD_LEAK_RULE_IDS = new Set([
  'aws-key',
  'openai-key',
  'github-pat',
  'google-key',
  'slack-token',
  'private-key',
]);

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
    skipPlaceholders: true,
  },
  {
    id: 'slack-token',
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
    title: 'Slack token',
    detail: 'Revoke immediately — Slack tokens grant workspace access.',
    severity: 'error',
    scope: 'both',
    skipPlaceholders: true,
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
    if (!HARD_LEAK_RULE_IDS.has(rule.id)) {
      // For code-scoped rules the "反例" caption usually sits in the prose
      // around the fence, not inside the extracted code itself — check the
      // full original text near where this snippet actually appears.
      const idx = rule.scope === 'code' ? text.indexOf(hit[0]) : hit.index ?? 0;
      if (idx >= 0) {
        const window = text.slice(Math.max(0, idx - 100), idx + hit[0].length + 100);
        if (NEGATIVE_EXAMPLE_RE.test(window)) continue;
      }
    }
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

// Scoped to loop headers only — a bare `index <= arr.length` in an ordinary
// boundary check (e.g. "is this a valid insert position?") is correct, not a
// bug. Off-by-one is specifically about walking one step past the last index.
const OFF_BY_ONE_RE =
  /\bfor\s*\([^{)]*?<=\s*(?:\w+(?:\.\w+)*\.length\b|len\s*\([^)]*\))[^{)]*?\)|\bwhile\s*\([^{)]*?<=\s*(?:\w+(?:\.\w+)*\.length\b|len\s*\([^)]*\))[^{)]*?\)|\bwhile\s+[^:\n]*?<=\s*len\s*\([^)]*\)[^:\n]*:/;

const CODE_QUALITY_RULES: CodeQualityRule[] = [
  {
    id: 'off-by-one',
    re: OFF_BY_ONE_RE,
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
    id: 'unawaited-promise',
    re: /^\s*(?!return|await|void|yield)(?:\w+\.)*\w+\([^)]*\)\.then\s*\([^)]*\)\s*;?\s*$/m,
    title: 'Floating promise',
    detail: 'A `.then()` chain with no await/catch loses errors — await it or add `.catch`.',
    severity: 'warn',
    langs: ['js'],
  },
];

const LOOSE_EQ_RE = /(?<![=!<>])(==|!=)(?!=)/g;

/**
 * `x == null` / `x != undefined` is a deliberate, widely-endorsed idiom that
 * catches both null and undefined in one check — not a coercion bug. Only
 * flag loose equality that isn't a null/undefined guard.
 */
function hasNonNullLooseEquality(code: string): boolean {
  for (const match of code.matchAll(LOOSE_EQ_RE)) {
    const idx = match.index ?? 0;
    const before = code.slice(Math.max(0, idx - 16), idx);
    const after = code.slice(idx + match[0].length, idx + match[0].length + 16);
    const isNullGuard =
      /(?:\bnull|\bundefined)\s*$/.test(before) || /^\s*(?:null\b|undefined\b)/.test(after);
    if (!isNullGuard) return true;
  }
  return false;
}

// Bare `state.x =` / `props.x =` is only a React bug inside React code — the
// same names are ordinary variables in state machines, reducers, game loops,
// etc. Require an actual React signal in the same block before flagging.
const REACT_CONTEXT_RE =
  /\buseState\b|\buseReducer\b|\bthis\.(?:state|props)\b|\bReact\.(?:Component|PureComponent)\b|\bextends\s+(?:React\.)?(?:Pure)?Component\b|<[A-Z]\w*[\s/>]|\breturn\s*\(?\s*<[a-zA-Z]/;
const STATE_PROPS_MUTATION_RE =
  /\b(?:state|props)(?:\.\w+)+\s*=(?!=)|\b(?:state|props)\[[^\]]+\]\s*=(?!=)/;

function hasReactStateMutation(code: string): boolean {
  return REACT_CONTEXT_RE.test(code) && STATE_PROPS_MUTATION_RE.test(code);
}

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
    if (lang === 'js' && hasNonNullLooseEquality(block.code)) {
      add({
        id: 'loose-equality',
        title: 'Loose equality (== / !=)',
        detail: 'Type coercion causes surprises — prefer `===` / `!==`.',
        severity: 'warn',
      });
    }
    if (lang === 'js' && hasReactStateMutation(block.code)) {
      add({
        id: 'state-mutation',
        title: 'Direct state/props mutation',
        detail: 'React state must be replaced, not mutated, or renders are skipped.',
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
// Completeness — structural / severe only (no semantic CTA heuristics)
// ---------------------------------------------------------------------------

/**
 * Detect mid-generation collapse: long runs of the same character, smashed URL
 * fragments, or a tail that is mostly non-prose noise. These are model failures,
 * not formatting bugs — flag them so the Review panel surfaces the break.
 */
export function detectDegenerateOutput(text: string): string | null {
  const raw = String(text || '');
  if (raw.length < 80) return null;

  // Long same-char / same-short-token runs (aaaaaaaa / AAAAA / ——–).
  const run = raw.match(/([^\s])\1{39,}/);
  if (run) {
    return `Output collapsed into a long repeated "${run[1]}" run — generation likely failed mid-reply.`;
  }

  const tail = raw.slice(-1200);
  // URL / path soup: many broken https fragments or hex-ish tokens jammed together.
  const httpsBits = (tail.match(/https?(?:s|:|\/)/gi) || []).length;
  const hexish = (tail.match(/\b[a-f0-9]{8,}\b/gi) || []).length;
  if (httpsBits >= 4 && /https?\s*https?/i.test(tail)) {
    return 'Tail looks like smashed URL fragments — generation likely failed mid-table or mid-citation.';
  }
  if (hexish >= 8 && /[a-z]{1,3}\d+[a-z]{1,3}/i.test(tail) && /[-_]{2,}|\.{2,}/.test(tail)) {
    return 'Tail is dominated by opaque token soup — generation likely failed.';
  }

  // High ratio of a single Latin letter in the last chunk (aaaa… / AAA…).
  const letters = tail.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 80) {
    const counts = new Map<string, number>();
    for (const ch of letters.toLowerCase()) counts.set(ch, (counts.get(ch) || 0) + 1);
    const top = Math.max(...counts.values());
    if (top / letters.length >= 0.55) {
      return 'Tail is dominated by one repeated letter — classic model-collapse pattern.';
    }
  }

  return null;
}

/**
 * Structural completeness only: token/stream cutoff, unclosed fences, collapse.
 * Semantic “did they finish the thought / is this a CTA?” is out of scope —
 * regex cannot judge that reliably and only adds false positives.
 */
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

  const degenerate = detectDegenerateOutput(raw);
  if (degenerate) {
    items.push({
      severity: 'error',
      title: 'Answer collapsed into garbage',
      detail: degenerate,
    });
  }

  if (!items.length) return null;
  return {
    id: 'completeness',
    kind: 'completeness',
    status: 'done',
    clean: false,
    summary:
      items.length === 1
        ? items[0]!.title
        : `Answer looks unfinished (${items.length} signal(s))`,
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

/**
 * Time-sensitive assertions vs retrieval freshness.
 * Only runs when this turn actually called web_search / web_read — otherwise
 * present-tense words in image transcripts ("最新告警") false-trigger.
 * Null when nothing to check.
 */
export function buildStalenessCheck(
  assistantText: string,
  record: ExecutionRecordEntry[],
  now: Date = new Date(),
): ReviewCheck | null {
  // Freshness is a property of web retrieval, not of every answer that says「最新」.
  if (!hasWebSearchOrReadReceipt(record)) return null;

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

/**
 * Trailing hedge words carry no metric identity: “实际约为 15%” is about SOME
 * metric named earlier, not a metric called 实际约. Strip them so the real
 * subject (有效税率实际约 → 有效税率) becomes the key; a bare hedge with no
 * subject is dropped entirely — it cannot be tracked as a metric.
 */
const TRAILING_HEDGE_RE =
  /(?:\s|实际约|约为|大约|大概|将近|约等于|实际|接近|近|约|approx(?:imately)?|roughly|around|about|nearly|near|circa)+$/i;

/**
 * Leading connectives glued onto CJK labels (因此毛利率为…) would split one
 * metric into several keys and hide real contradictions — peel them off.
 */
const LEADING_CONNECTIVE_RE =
  /^(?:因此|所以|但是|不过|然而|但|而|则|即|故|因为|由于|同时|另外|此外|最终|最后|综上|合计|总计|其中|目前|现在|经计算|经过计算|计算后|得出|得到|可见|说明|表明|意味着)+/;

const LABELED_NUMBER_RE =
  /([\p{L}\p{N}][\p{L}\p{N}_ ·%（）()-]{1,22})\s*(?:[:：]|是|为)\s*([-−]?\d[\d,._]*(?:\.\d+)?)\s*([%％]|万|亿|个|人|元|美元|天|小时|分钟|次|倍)?/gu;

function normalizeLabel(raw: string): string {
  return raw
    .replace(/[*_`#>]/g, '')
    .replace(/^[\s,.、，。;；:：-]+|[\s,.、，。;；:：-]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

type ConsistencyHit = {
  value: string;
  index: number;
  /** Other numeric tokens on the hit's line — row keys like $12k / $18k. */
  discriminators: Set<string>;
  /** First cell when the hit sits in a markdown table row. */
  rowKey: string;
};

function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  let end = text.indexOf('\n', index);
  if (end < 0) end = text.length;
  return text.slice(start, end);
}

function numbersInLine(line: string): string[] {
  return [...line.matchAll(/[-−]?\d[\d.,_]*/g)].map((m) =>
    m[0].replace(/[,_]/g, '').replace(/[−]/g, '-'),
  );
}

/**
 * Two same-label hits with different values are still fine when their lines are
 * distinguished by other data — different table-row keys or different companion
 * numbers mean “enumeration over cases” (income brackets, product tiers), not a
 * contradiction. Only symmetric distinguishing evidence counts: each side must
 * have a token the other lacks.
 */
function hitsDistinguishable(a: ConsistencyHit, b: ConsistencyHit): boolean {
  if (a.rowKey && b.rowKey && a.rowKey !== b.rowKey) return true;
  // The two compared values themselves are not context — when both hits share a
  // paragraph, each other's value would otherwise fake a distinguishing token.
  const ignore = new Set([a.value, b.value]);
  const aOnly = [...a.discriminators].some(
    (t) => !ignore.has(t) && !b.discriminators.has(t),
  );
  const bOnly = [...b.discriminators].some(
    (t) => !ignore.has(t) && !a.discriminators.has(t),
  );
  return aOnly && bOnly;
}

/** Same metric asserted with different values far apart in the answer. */
export function buildConsistencyCheck(assistantText: string): ReviewCheck | null {
  const text = stripCodeBlocks(assistantText);
  if (text.trim().length < 120) return null;

  const byKey = new Map<string, ConsistencyHit[]>();

  for (const match of text.matchAll(LABELED_NUMBER_RE)) {
    const label = normalizeLabel(match[1])
      .replace(LEADING_CONNECTIVE_RE, '')
      .replace(TRAILING_HEDGE_RE, '');
    if (label.length < 2 || GENERIC_LABEL_RE.test(label)) continue;
    const unit = match[3] || '';
    const value = match[2].replace(/[,_\s]/g, '').replace(/[−]/g, '-');
    const index = match.index ?? 0;
    const line = lineAt(text, index);
    const discriminators = new Set(numbersInLine(line).filter((v) => v !== value));
    const rowKey = line.includes('|') ? splitTableRow(line)[0] || '' : '';
    const key = `${label}|${unit}`;
    const list = byKey.get(key) || [];
    list.push({ value, index, discriminators, rowKey });
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
    // A conflict needs at least one pair of differing values whose contexts are
    // NOT otherwise distinguished (same row key, same companion numbers).
    let conflicting: [ConsistencyHit, ConsistencyHit] | null = null;
    outer: for (let i = 0; i < hits.length; i++) {
      for (let j = i + 1; j < hits.length; j++) {
        if (hits[i].value === hits[j].value) continue;
        if (!hitsDistinguishable(hits[i], hits[j])) {
          conflicting = [hits[i], hits[j]];
          break outer;
        }
      }
    }
    if (!conflicting) continue;
    const [label, unit] = key.split('|');
    items.push({
      severity: 'warn',
      title: `"${label}" stated as ${conflicting.map((h) => h.value).join(' vs ')}${unit ? ` ${unit}` : ''}`,
      detail: 'The same metric carries different values in different parts of the answer, with no distinguishing context (different table rows or companion figures would exempt it).',
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
 *
 * Severity-aware escalation (foundry-research `deep-research-revision` verifier
 * gating: full/targeted/skip by high-severity count). A single blurb-only
 * `unverifiable` warn is not worth an LLM call on its own — that verdict is
 * already final (absence from a search snippet proves nothing). Escalate on
 * any confirmed local error, or once weak warns accumulate enough that an
 * independent look is worth the cost.
 */
export function planReviewChecks(input: ReviewInput): ReviewPlan {
  const checks = runLocalChecks(input);
  const localErrorIssues = checks.reduce(
    (n, c) => n + (c.items?.filter((it) => it.severity === 'error').length || 0),
    0,
  );
  const localWarnIssues = checks.reduce(
    (n, c) => n + (c.items?.filter((it) => it.severity === 'warn').length || 0),
    0,
  );
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
  } else if (localErrorIssues) {
    llm = true;
    reason = `${localErrorIssues} local error(s) worth a second opinion`;
  } else if (localWarnIssues >= 3) {
    llm = true;
    reason = `${localWarnIssues} local warn(s) accumulated — second opinion`;
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
  const checks = dedupeReviewChecks(applyLensFindings(runLocalChecks(input), lensFindings));
  return { phase: input.phase, status, checks };
}

function extractNumericTokens(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text || '').matchAll(/\d+(?:[.,]\d+)*%?/g)) {
    const norm = m[0].replace(/,/g, '');
    if (norm.length >= 2) out.add(norm);
  }
  return [...out];
}

function titleWords(text: string): Set<string> {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/**
 * Cross-check dedup (foundry-research `dedup-issues`): different lenses
 * (consistency, citation, tool_receipt, …) can independently flag the same
 * underlying number. Without this, the panel shows the same problem twice
 * with different phrasing — wasted space, and it reads as two bugs instead
 * of one. Merge same-kind-crossing items that share a distinctive numeric
 * token and enough title overlap; keep the stronger verdict and note both
 * lenses flagged it. Never merges within the same check (a check already
 * dedupes its own items).
 */
export function dedupeReviewChecks(checks: ReviewCheck[]): ReviewCheck[] {
  type Flat = { checkIdx: number; itemIdx: number; kind: ReviewCheckKind; item: ReviewCheckItem };
  const flat: Flat[] = [];
  checks.forEach((c, ci) =>
    c.items.forEach((item, ii) => flat.push({ checkIdx: ci, itemIdx: ii, kind: c.kind, item })),
  );

  const dropKeys = new Set<string>();
  const keyOf = (f: Flat) => `${f.checkIdx}:${f.itemIdx}`;

  for (let i = 0; i < flat.length; i++) {
    if (dropKeys.has(keyOf(flat[i]))) continue;
    for (let j = i + 1; j < flat.length; j++) {
      if (flat[i].kind === flat[j].kind) continue;
      if (dropKeys.has(keyOf(flat[j]))) continue;
      const a = flat[i].item;
      const b = flat[j].item;
      const numA = extractNumericTokens(`${a.title} ${a.detail}`);
      if (!numA.length) continue;
      const numB = extractNumericTokens(`${b.title} ${b.detail}`);
      if (!numA.some((n) => numB.includes(n))) continue;
      if (jaccard(titleWords(a.title), titleWords(b.title)) < 0.4) continue;

      const aStrong = a.severity === 'error';
      const bStrong = b.severity === 'error';
      const keepFirst = aStrong === bStrong ? a.detail.length >= b.detail.length : aStrong;
      const winner = keepFirst ? flat[i] : flat[j];
      const loser = keepFirst ? flat[j] : flat[i];
      const severity: ReviewCheckItem['severity'] = aStrong || bStrong ? 'error' : winner.item.severity;
      const detail = /also flagged by/i.test(winner.item.detail)
        ? winner.item.detail
        : `${winner.item.detail} (also flagged by ${loser.kind})`;
      checks[winner.checkIdx].items[winner.itemIdx] = { ...winner.item, severity, detail };
      dropKeys.add(keyOf(loser));
    }
  }

  if (!dropKeys.size) return checks;
  return checks.map((c, ci) => {
    const items = c.items.filter((_, ii) => !dropKeys.has(`${ci}:${ii}`));
    if (items.length === c.items.length) return c;
    return { ...c, items, clean: items.length === 0 };
  });
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
  'create_file',
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
  '{"findings":[{"severity":"error"|"warn","surface":"notion"|"github"|"gmail"|"calendar"|"drive"|"web_search"|"web_read"|"save_skill"|"create_file","verdict":"pending_intent"|"unsupported"|"tool_failed"|"no_receipt","claim":"short quote or paraphrase","evidence":"which receipt contradicts or is missing"}],"summary":"one sentence"}',
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
    '- citation: a cited URL missing from receipts, or a figure attributed to a source whose evidence units do not contain it. Distinguish unverifiable (search blurb only) from unsupported (web_read body). Never treat blurb absence as proof the article is wrong.',
  consistency:
    '- consistency: the answer contradicting itself — same metric with different values, a conclusion that reverses an earlier statement, steps that do not follow from each other.',
  completeness:
    '- completeness: ONLY structural unfinished signals — token/stream cutoff, unclosed ``` fences, or collapsed garbage tails. Do NOT flag normal CTAs that ask the user what to do next.',
  staleness:
    '- staleness: only when this turn ran web_search/web_read — present-tense claims ("currently", "latest") whose sources look stale, or a stated cutoff older than the sources. Skip when there was no web retrieval (e.g. image transcription).',
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

/** Compact receipt list for the Review panel — not the full verifier dump. */
export function formatExecutionRecordForUi(record: ExecutionRecordEntry[]): string {
  if (!record.length) return '';
  return record
    .map((e, i) => {
      const status = e.ok ? 'ok' : 'failed';
      const hits = e.urls?.length || e.sources?.length || 0;
      const parts = [`${i + 1}. ${e.tool} (${status})`];
      if (e.query) parts.push(e.query.slice(0, 72));
      if (hits) parts.push(`${hits} hit(s)`);
      if (!e.ok && e.error) parts.push(e.error.slice(0, 100));
      return parts.join(' · ');
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

/**
 * Only high-confidence findings may drive the model to amend its own answer.
 * Heuristic warns (citation blurb gaps / unverifiable, consistency guesses,
 * staleness hints) stay in the Review panel — feeding them to the model makes
 * it "correct" things that were never proven wrong.
 *
 * Gate level 0 (REVIEW_GATE_LEVEL=0): annotate-only — never auto-correct.
 * Gate level 1/2 (default 1): soft gate — errors may drive a correction note.
 *
 * Model-collapse / garbage tails are also panel-only: asking the same soft model
 * to rewrite the broken stretch often produces more garbage.
 */
export function actionableReviewIssues(issues: ReviewIssue[]): ReviewIssue[] {
  if (getReviewGateLevel() === 0) return [];
  return issues.filter((i) => {
    if (i.severity !== 'error') return false;
    // Blurb-only / unverifiable must never drive correction (Foundry: unverifiable ≠ wrong).
    if (/\[unverifiable\b/i.test(i.detail) || /\bunverifiable\b/i.test(`${i.title} ${i.detail}`)) {
      return false;
    }
    if (/collapsed into garbage|degenerat|repeated letter|smashed URL|token soup/i.test(`${i.title} ${i.detail}`)) {
      return false;
    }
    // Completeness auto-correct only for hard structural failures.
    if (
      i.kind === 'completeness' &&
      !/cut off|Unclosed code|collapsed into garbage/i.test(`${i.title} ${i.detail}`)
    ) {
      return false;
    }
    return true;
  });
}

export type CorrectionVerifyResult = {
  ok: boolean;
  text: string;
  /** Why the draft was rejected (when ok is false). */
  reason?: string;
};

/** True when the "correction" largely reprints the prior answer (duplicate output). */
export function looksLikeRestatedAnswer(draft: string, prior: string): boolean {
  const d = String(draft || '').replace(/\s+/g, '');
  const p = String(prior || '').replace(/\s+/g, '');
  if (d.length < 100 || p.length < 100) return false;
  // Short annotation restating a long answer is fine; near-equal length rewrites are not.
  if (d.length > Math.max(280, p.length * 0.55)) {
    const window = 72;
    let hits = 0;
    for (let i = 0; i + window <= p.length; i += 48) {
      if (d.includes(p.slice(i, i + window))) hits += 1;
      if (hits >= 2) return true;
    }
  }
  return false;
}

/**
 * Re-run local checks on a post-review correction draft. Rejects drafts that
 * are degenerate, introduce new arithmetic errors, or rewrite the whole answer.
 */
export function verifyCorrectionText(
  draft: string,
  opts?: { priorLength?: number; priorText?: string },
): CorrectionVerifyResult {
  const text = String(draft || '').trim();
  if (!text) {
    return { ok: false, text: '', reason: 'empty correction' };
  }

  const degenerate = detectDegenerateOutput(text);
  if (degenerate) {
    return { ok: false, text, reason: degenerate };
  }

  // Corrections must stay short — a full rewrite means the model ignored the brief.
  const prior = opts?.priorLength || 0;
  if (prior > 400 && text.length > Math.max(1200, prior * 0.45)) {
    return {
      ok: false,
      text,
      reason: 'correction rewrote too much of the prior answer',
    };
  }

  const priorText = String(opts?.priorText || '').trim();
  if (priorText && looksLikeRestatedAnswer(text, priorText)) {
    return {
      ok: false,
      text,
      reason: 'correction restates the prior answer instead of a short delta note',
    };
  }

  const recalc = buildRecalculationCheck(text);
  if (recalc?.items?.some((i) => i.severity === 'error')) {
    return {
      ok: false,
      text,
      reason: `correction introduces arithmetic error: ${recalc.items[0].title}`,
    };
  }

  const consistency = buildConsistencyCheck(text);
  if (consistency?.items?.length) {
    return {
      ok: false,
      text,
      reason: `correction introduces inconsistency: ${consistency.items[0].title}`,
    };
  }

  return { ok: true, text };
}

/** Fallback note when a correction draft fails local verification. */
export function rejectedCorrectionNote(reason: string): string {
  return [
    '复核说明未能通过本地校验，已放弃自动改写，以免越改越错。',
    `原因：${reason}`,
    '请以原文 + Review 面板中的发现为准；需要时可手动续写或换模型重试。',
  ].join('\n');
}

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
    'The prior answer is already visible — annotate what is unsupported; do not claim to have deleted on-screen text.',
    'Address each finding honestly: say what was NOT done or not backed by a receipt.',
    'Be brief. Do not invent notion.so / github.com / google.com links. Do not call tools.',
    '',
    '## Findings',
    list,
    excerpt ? `\n## Prior answer excerpt\n${excerpt}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Prompt covering every Review check issue — delta note only, never a full rewrite. */
export function buildReviewIssuesResponsePrompt(
  issues: ReviewIssue[],
  assistantText?: string,
): string {
  if (!issues.length) {
    return [
      'Automatic review found no issues in the previous answer.',
      'Reply with a single short sentence confirming nothing needs changing. Do not call tools.',
    ].join(' ');
  }
  const list = issues
    .map(
      (issue, i) =>
        `${i + 1}. [${issue.severity}/${issue.kind}] ${issue.title}\n   ${issue.detail}`,
    )
    .join('\n');
  // Tiny excerpt only for locating the bad claim — not so the model can rewrite everything.
  const excerpt = String(assistantText || '').trim().slice(0, 800);
  return [
    'Automatic review found issues in the previous answer (already shown to the user above the Review panel).',
    'Write a SHORT annotation note only — the original answer stays visible and cannot be un-sent.',
    '',
    'Hard rules:',
    '- Do NOT repeat or rewrite the full prior answer.',
    '- Do NOT restate sections that were already fine.',
    '- Do NOT say you “revoked / 撤销 / removed / deleted” text that the user can still see above.',
    '- Do NOT ask the user to ignore the whole answer, and do not re-output a corrected full answer.',
    '- Prefer a few bullets or one short paragraph (usually under 120 words).',
    '- For citation issues marked unsupported (full page evidence): say the figure is not backed by the read page text. For unverifiable (search blurb only): say the number was not in the retrieval headline — do not claim the article is wrong, and do not pretend the body was read.',
    '- For arithmetic: state the corrected equation/number only.',
    '- For tool-receipt issues: say what was not actually done / not backed by a receipt.',
    '- Do not invent tool actions, URLs, or receipts that were never returned.',
    '- Do not call tools.',
    '',
    '## Review issues',
    list,
    excerpt ? `\n## Prior answer excerpt (context only — do not reprint)\n${excerpt}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export const FINDINGS_RESPONSE_SYSTEM = [
  'You write a brief review annotation after an automatic check.',
  'The prior answer is already on screen — you cannot unsay it. Annotate risks and limits; do not claim to have revoked or deleted visible text.',
  'Output ONLY a short delta note — never a full restatement of the prior answer.',
  'Be concise and honest. Prefer “未在检索摘要中核实 / 请谨慎采信” for unverifiable blurbs; use “全文摘录中未见” only when evidence was a full page read.',
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
