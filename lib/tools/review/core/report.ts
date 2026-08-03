import { buildCitationCheck } from '@/lib/tools/review/checks/citation';
import { buildCodeQualityCheck } from '@/lib/tools/review/checks/code-quality';
import { buildCompletenessCheck } from '@/lib/tools/review/checks/completeness';
import { buildConsistencyCheck } from '@/lib/tools/review/checks/consistency';
import { buildRecalculationCheck } from '@/lib/tools/review/checks/recalculation';
import { buildStalenessCheck } from '@/lib/tools/review/checks/staleness';
import {
  buildMidTurnCheck,
  buildToolReceiptCheck,
  INTENT_LABELS,
  SURFACE_LABELS,
  synthesizeFindings,
} from '@/lib/tools/review/checks/tool-claims';
import { buildVulnerabilityCheck } from '@/lib/tools/review/checks/vulnerability';
import type {
  ExecutionRecordEntry,
  FakedToolSurface,
  LensFinding,
  MidTurnCorrection,
  ReviewCheck,
  ReviewCheckItem,
  ReviewCheckKind,
  ReviewFinding,
  ReviewInput,
  ReviewLens,
  ReviewPlan,
  ReviewReport,
  ReviewerPhase,
} from '@/lib/tools/review/core/types';
import { REVIEWER_CHECK_KINDS } from '@/lib/tools/review/core/types';
import { extractNumericTokens, jaccard, titleWords } from '@/lib/tools/review/core/shared';

function shouldIncludeToolReceipt(
  phase: ReviewerPhase,
  findings: ReviewFinding[],
  record: ExecutionRecordEntry[],
): boolean {
  return phase === 'requested' || findings.length > 0 || record.length > 0;
}

export function mergeReviewChecks(
  prev: ReviewCheck[],
  next: ReviewCheck[],
): ReviewCheck[] {
  const byKind = new Map<ReviewCheckKind, ReviewCheck>();
  for (const c of prev) byKind.set(c.kind, c);
  for (const c of next) byKind.set(c.kind, c);
  return REVIEWER_CHECK_KINDS.filter((k) => byKind.has(k)).map((k) => byKind.get(k)!);
}

const LENS_KINDS: ReviewLens[] = [
  'tool_receipt',
  'citation',
  'consistency',
  'completeness',
  'staleness',
  'code_quality',
];

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

const LENS_DEFAULT_SUMMARY: Record<ReviewLens, string> = {
  tool_receipt: 'Verifier flagged tool-usage issues',
  citation: 'Verifier flagged citation issues',
  consistency: 'Verifier found contradictions',
  completeness: 'Verifier found gaps',
  staleness: 'Verifier flagged freshness risks',
  code_quality: 'Verifier flagged correctness issues',
};

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

/** Manual `/review` Process-card tools (Deep Research style stages). */
export type ReviewProcessToolName = 'claim_audit' | 'claim_verifier' | 'review_report';

export function reviewProcessErrorMessage(err: unknown, fallback = 'Review failed'): string {
  if (!err) return fallback;
  if (typeof err === 'object' && err !== null && 'name' in err) {
    const name = String((err as { name?: unknown }).name || '');
    if (name === 'AbortError') return 'Review aborted';
  }
  if (err instanceof Error && err.message.trim()) return err.message.slice(0, 280);
  const text = String(err || '').trim();
  return text ? text.slice(0, 280) : fallback;
}

/**
 * Emit a visible Process card for manual `/review` stages.
 * Callers must pair every `start` with a `done` (success or `error`) —
 * otherwise stream settle silently marks the card complete.
 */
export function emitReviewProcessCard(
  send: (payload: Record<string, unknown>) => void,
  opts: {
    name: ReviewProcessToolName;
    status: 'start' | 'done';
    query: string;
    error?: string;
    results?: Array<{ title: string; url: string; snippet: string }>;
  },
): void {
  send({
    tool: {
      name: opts.name,
      status: opts.status,
      provider: 'review',
      query: opts.query,
      ...(opts.error ? { error: opts.error } : {}),
      ...(opts.results ? { results: opts.results } : {}),
    },
  });
}

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
