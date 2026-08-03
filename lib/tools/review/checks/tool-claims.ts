import {
  extractEvidenceFromPayload,
  makeEvidenceUnit,
} from '@/lib/tools/review/core/evidence';
import type {
  ChatMessageLike,
  ClientToolRun,
  ExecutionRecordEntry,
  ExecutionSource,
  FakedToolSurface,
  MidTurnCorrection,
  MidTurnCorrectionKind,
  ReviewCheck,
  ReviewCheckItem,
  ReviewFinding,
  ReviewFindingVerdict,
  ReviewReport,
} from '@/lib/tools/review/core/types';
import { extractUrls, formatExecutionRecordForUi, normalizeUrl, trimUrlTail } from '@/lib/tools/review/core/shared';

export const REVIEWER_SYSTEM_PROMPT = [
  '【Claim Reviewer — 高置信度约束】',
  '只审查助手对本轮真实外部操作作出的直接完成声明，例如“我已创建/更新/发送/搜索/保存”。此类声明必须有成功 tool_calls 回执。',
  '教程、步骤说明、示例/反例、引用、假设、条件句、建议、能力描述，以及“应当/可以/不要声称”等规范性文字都不是执行声明，不得据此判错。',
  '只有当回复停在明确的第一人称即时操作承诺（如“我现在去搜索”）且没有 tool_calls 时，才要求继续调用或撤回。语义不确定时保持宽松，不强制纠正。',
].join('');

function proseOutsideCodeExamples(text: string): string {
  return String(text || '')
    .replace(/```[\s\S]*?(?:```|$)/g, '')
    .replace(/`[^`\n]*`/g, '')
    // Markdown quotations usually reproduce user/source text, not the assistant's action.
    .replace(/^\s*>.*$/gm, '');
}

const NON_OPERATIONAL_PREFIX_RE =
  /^\s*(?:#{1,6}\s*)?(?:示例|例如|比如|举例|反例|错误(?:示例)?|正确(?:示例)?|注意|说明|规则|要求|约束|流程|步骤|模板|格式|伪代码|教程|用法|建议|如果|若|假如|假设|当.+时|可(?:以|用于)|应(?:当|该)|需要|必须|不得|不要|禁止|避免|推荐|我(?:可以|能够|能)(?:先|再|帮你)?|用户可以|模型可以|the example|example|anti-example|if\b|when\b|should\b|must\b|never\b|do not\b|I can\b|we can\b)/i;

function operationalSegments(text: string): string[] {
  return proseOutsideCodeExamples(text)
    .split(/\n+|(?<=[。！？!?；;])\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !NON_OPERATIONAL_PREFIX_RE.test(segment))
    .filter(
      (segment) =>
        !/(?:不要|不得|禁止|避免|不能|不可|无需|不应|未曾|没有)(?:.{0,12})(?:声称|表示|假装|编造|创建|更新|发送|保存|搜索|读取)/i.test(
          segment,
        ),
    );
}

function someOperationalSegment(text: string, predicate: (segment: string) => boolean): boolean {
  return operationalSegments(text).some(predicate);
}

export function detectFakedToolNarration(
  text: string,
  opts: { searchEnabled: boolean; integrations: string[]; skillCreator?: boolean },
): FakedToolSurface[] {
  // Evaluate local prose segments instead of combining unrelated keywords
  // across an entire tutorial or long-form answer.
  const t = proseOutsideCodeExamples(text);
  if (!t.trim()) return [];
  const set = new Set(
    (opts.integrations || []).map((id) => String(id || '').trim().toLowerCase()),
  );
  const found: FakedToolSurface[] = [];

  if (set.has('notion')) {
    const claimsNotionWrite = someOperationalSegment(t, (segment) => {
      const notionSignal = /Notion|notion\.so|notion\.site|notion 页面/i.test(segment);
      const directCompletion =
        /(?:我|已经|已|刚刚|现已).{0,6}(?:更新|写入|创建|改好|重构).{0,14}(?:Notion|页面|模板)|(?:updated|created|wrote)\s+(?:the\s+)?(?:notion\s+)?page/i.test(
          segment,
        );
      return notionSignal && directCompletion;
    });
    if (claimsNotionWrite) found.push('notion');
  }

  if (set.has('github')) {
    if (
      someOperationalSegment(t, (segment) =>
        /(?:我|已经|已|刚刚|现已).{0,6}(?:创建|提交|打开|评论).{0,12}(?:issue|PR|pull request|拉取请求)|(?:I\s+)?(?:created|opened|commented on)\s+(?:an?\s+|the\s+)?(?:issue|PR|pull request)/i.test(
          segment,
        ),
      )
    ) {
      found.push('github');
    }
  }

  if (set.has('gmail')) {
    if (
      someOperationalSegment(t, (segment) =>
        /(?:我|已经|已|刚刚|现已).{0,6}(?:发送|回复|转发).{0,8}(?:邮件|邮箱|gmail)|(?:I\s+)?(?:sent|replied to|forwarded)\s+(?:the\s+)?(?:email|mail)/i.test(
          segment,
        ),
      )
    ) {
      found.push('gmail');
    }
  }

  if (set.has('calendar')) {
    if (
      someOperationalSegment(t, (segment) =>
        /(?:我|已经|已|刚刚|现已).{0,6}(?:创建|添加|安排).{0,10}(?:日程|日历|会议|event)|(?:I\s+)?(?:created|scheduled)\s+(?:a\s+)?(?:calendar\s+)?(?:meeting|event)/i.test(
          segment,
        ),
      )
    ) {
      found.push('calendar');
    }
  }

  if (set.has('drive')) {
    if (
      someOperationalSegment(t, (segment) =>
        /(?:我|已经|已|刚刚|现已).{0,6}(?:上传|创建|分享).{0,10}(?:文件|文档|Drive|网盘)|(?:I\s+)?(?:uploaded|created|shared)\s+(?:a\s+|the\s+)?(?:file|doc|document)/i.test(
          segment,
        ),
      )
    ) {
      found.push('drive');
    }
  }

  if (opts.searchEnabled) {
    if (
      someOperationalSegment(
        t,
        (segment) =>
          /(?:根据(?:我的|本轮|刚才的)?(?:联网)?搜索结果|搜索结果(?:显示|表明)|我(?:已经|已|刚刚)?检索到|according to (?:my |the )?(?:web )?search|I found the following links)/i.test(
            segment,
          ) && /https?:\/\//i.test(segment),
      )
    ) {
      found.push('web_search');
    }
    if (
      someOperationalSegment(
        t,
        (segment) =>
          /(?:我(?:已经|已|刚刚)?(?:读完|阅读完|抓取了|打开并读了)|I (?:have )?read (?:the )?(?:page|article)|according to the page I (?:just )?read)/i.test(
            segment,
          ) && /https?:\/\//i.test(segment),
      )
    ) {
      found.push('web_read');
    }
  }

  if (opts.skillCreator) {
    if (
      someOperationalSegment(t, (segment) =>
        /(?:我|已经|已|刚刚|现已).{0,8}(?:保存|存入).{0,10}skill|skill.{0,8}(?:保存成功|已(?:经)?保存)|(?:I\s+)?saved\s+(?:the\s+)?skill/i.test(
          segment,
        ),
      )
    ) {
      found.push('save_skill');
    }
  }

  if (
    someOperationalSegment(t, (segment) =>
      /(?:我|已经|已|刚刚|现已).{0,8}(?:用\s*create_file\s*)?(?:生成|创建|写入|保存).{0,16}(?:\.md|\.pdf|\.docx|\.xlsx|\.png|\.py|\.ts|\.tsx|\.js|\.json|\.txt)(?:\b|文件)|(?:I\s+)?(?:created|saved|wrote)\s+(?:the\s+)?file(?:\s+to)?/i.test(
        segment,
      ),
    )
  ) {
    found.push('create_file');
  }

  return found;
}

export function detectPendingToolIntent(
  text: string,
  opts: { searchEnabled: boolean; integrations: string[] },
): FakedToolSurface[] {
  // Intent correction is disruptive, so only inspect the final two operational
  // segments. A tutorial may describe “first search, then read” much earlier.
  const segments = operationalSegments(text).slice(-2);
  if (!segments.length) return [];
  const set = new Set(
    (opts.integrations || []).map((id) => String(id || '').trim().toLowerCase()),
  );
  const found: FakedToolSurface[] = [];
  const matchesTail = (pattern: RegExp) => segments.some((segment) => pattern.test(segment));

  if (
    set.has('notion') &&
    matchesTail(
      /(?:让我|我(?:现在|马上|先|来)|正在).{0,8}(?:读取|获取|拉取|打开|查看).{0,16}(?:Notion|当前页面|页面内容)|let me (?:first )?(?:fetch|read|get|load).{0,24}(?:page|notion)|I(?:'ll| will) (?:now |first )?(?:fetch|read|get).{0,24}(?:page|notion)/i,
    )
  ) {
    found.push('notion');
  }

  if (opts.searchEnabled) {
    if (
      matchesTail(
        /(?:让我|我(?:现在|马上|立即|来)|正在).{0,8}(?:联网|上网)?(?:搜索|搜一下|查一下)|I(?:'ll| will) search (?:now|the web)|let me search (?:the web|online|now)|searching (?:the )?(?:web|internet) now/i,
      )
    ) {
      found.push('web_search');
    }
    if (
      matchesTail(
        /(?:让我|我(?:现在|马上|先|来)|正在).{0,8}(?:读|打开|读取).{0,10}(?:链接|网页|文章)|let me (?:read|open) (?:the )?(?:page|link|article)|I(?:'ll| will) (?:now )?(?:read|open) (?:the )?(?:page|link|article)/i,
      )
    ) {
      found.push('web_read');
    }
  }

  if (
    set.has('github') &&
    matchesTail(
      /(?:让我|我(?:现在|马上|先|来)|正在).{0,8}(?:看|读|获取|检查).{0,12}(?:仓库|repo|issue|PR)|let me (?:check|fetch|read).{0,12}(?:repo|issue|PR|pull)|I(?:'ll| will) (?:now |first )?(?:check|fetch|read).{0,12}(?:repo|issue|PR|pull)/i,
    )
  ) {
    found.push('github');
  }

  return found;
}

export const SURFACE_LABELS: Record<FakedToolSurface, string> = {
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

export const INTENT_LABELS: Record<FakedToolSurface, string> = {
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

export function lastUserMessageIndex(messages: ChatMessageLike[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return i;
  }
  return -1;
}

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

export function findingId(surface: FakedToolSurface, verdict: ReviewFindingVerdict): string {
  return `${surface}:${verdict}`;
}

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
      severity: 'error' as const,
      title: label,
      detail:
        kind === 'intent'
          ? 'Stopped after announcing intent; reviewer forced another tool round.'
          : 'Claimed success with no matching tool_calls; reviewer injected corrective prompt.',
      ruleId: `mid_turn:${kind}`,
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
  send({ reviewer_report: buildMidTurnLiveReport(mid) });
}

export function buildToolReceiptCheck(
  findings: ReviewFinding[],
  record: ExecutionRecordEntry[],
): ReviewCheck {
  const items: ReviewCheckItem[] = findings.map((f) => ({
    severity: f.severity,
    title: f.claim,
    detail: f.evidence,
    ruleId: `tool_receipt:${f.verdict}`,
    verdict: f.verdict,
    surface: f.surface,
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
