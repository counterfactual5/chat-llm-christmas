import { getReviewGateLevel } from '@/lib/tools/review/core/evidence';
import { buildConsistencyCheck } from '@/lib/tools/review/checks/consistency';
import { detectDegenerateOutput } from '@/lib/tools/review/checks/completeness';
import { buildRecalculationCheck } from '@/lib/tools/review/checks/recalculation';
import {
  buildReviewReport,
  emitReviewReport,
  emitReviewerFindings,
  planReviewChecks,
} from '@/lib/tools/review/core/report';
import { findingId, synthesizeFindings } from '@/lib/tools/review/checks/tool-claims';
import type {
  ClaimAuditResult,
  CorrectionVerifyResult,
  ExecutionRecordEntry,
  FakedToolSurface,
  LensFinding,
  LlmCompleteFn,
  MidTurnCorrection,
  ReviewCheckStatus,
  ReviewFinding,
  ReviewFindingVerdict,
  ReviewInput,
  ReviewIssue,
  ReviewLens,
  ReviewReport,
  ReviewerPhase,
  VerifierResult,
} from '@/lib/tools/review/core/types';

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

export const VERIFIER_SYSTEM_PROMPT = [
  'You are an independent claim verifier. You are NOT the assistant that wrote the answer.',
  'You only compare ASSISTANT TEXT against EXECUTION RECORD (tool receipts).',
  'Do not invent tools that are not in the record. Do not trust the assistant narrative.',
  'Output ONLY valid JSON (no markdown fences) with this shape:',
  '{"findings":[{"severity":"error"|"warn","surface":"notion"|"github"|"gmail"|"calendar"|"drive"|"web_search"|"web_read"|"save_skill"|"create_file","verdict":"pending_intent"|"unsupported"|"tool_failed"|"no_receipt","claim":"short quote or paraphrase","evidence":"which receipt contradicts or is missing"}],"summary":"one sentence"}',
  'Rules:',
  '- pending_intent: only an explicit first-person immediate promise at the END of the answer (for example “I will search now”) that stopped without a matching call.',
  '- no_receipt: only a direct first-person completion claim about this turn (for example “I created the page” or “according to my search”) with no matching successful receipt.',
  '- tool_failed: only when the assistant directly says the action succeeded but the matching receipt explicitly failed.',
  '- unsupported: claim is weakly tied to receipts (use sparingly and only as warn).',
  '- NEVER treat tutorials, workflow steps, examples/anti-examples, quotations, hypothetical or conditional wording, recommendations, capability descriptions, or rules such as “do not claim it was saved” as executed actions.',
  '- Mere mentions of tool names, URLs, “search results”, files, pages, email, PRs, or phrases inside code blocks are not execution claims.',
  '- Do not duplicate pure URL-list mismatches (a separate citation check covers those). Focus on whether narrated actions/results match receipts.',
  '- If semantic intent is ambiguous, return no finding. Prefer false negatives over interrupting a valid answer.',
  '- If everything checks out, return {"findings":[],"summary":"All checked claims match receipts."}.',
  '- Prefer fewer high-confidence findings over speculative ones.',
].join('\n');

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

export function actionableReviewIssues(issues: ReviewIssue[]): ReviewIssue[] {
  if (getReviewGateLevel() === 0) return [];
  return issues.filter((issue) => {
    if (issue.severity !== 'error') return false;
    const text = `${issue.title} ${issue.detail}`;

    // Automatic rewriting is intentionally narrower than the review panel.
    // Semantic/heuristic checks remain visible, but should not interrupt a
    // useful answer unless they establish a concrete, high-confidence failure.
    if (issue.kind === 'mid_turn' || issue.kind === 'tool_receipt') {
      return /no matching|without.*receipt|tool failed|claimed.*succeeded|forced another tool round/i.test(
        text,
      );
    }
    if (issue.kind === 'recalculation') return /Verified as|Column verifies as/i.test(text);
    if (issue.kind === 'completeness') return /cut off|Unclosed code block/i.test(text);
    if (issue.kind === 'vulnerability') {
      return /credential|access key|private key|secret|token/i.test(text);
    }

    // Citation, staleness, consistency, and code-quality findings may depend on
    // incomplete context or style choices. Show them as advice; never auto-rewrite.
    return false;
  });
}

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
