/**
 * Continue / claim-review turn planning — pure decisions + prompts.
 * The chat hook still owns streaming / loading; this module answers
 * “may we resume?”, “which resume branch?”, and “what API payload?”.
 */

import type { Message } from '@/lib/chat/types';
import {
  analyzeTruncation,
  assistantMismatchesUserTopic,
  buildContinuationPrompt,
  looksAbruptlyCutOff,
} from '@/lib/chat/stream/reply-truncation';

export const CLAIM_REVIEW_USER_PROMPT = [
  'Claim Review: audit your previous assistant answer.',
  'For each claim of a tool action, web search, or factual statement, verify it against the tool results in this conversation.',
  'Retract any claim that lacks a real tool receipt; otherwise confirm it is verified. Be brief.',
].join(' ');

/** Manual `/review` prompt — optional user focus is appended when present. */
export function buildClaimReviewUserPrompt(focus?: string): string {
  const base = CLAIM_REVIEW_USER_PROMPT;
  const extra = String(focus || '').trim();
  if (!extra) return base;
  return [
    base,
    '',
    'Additional review focus from the user (prioritize these concerns):',
    extra,
  ].join('\n');
}

export const EMPTY_AFTER_PROCESS_PROMPT = [
  'Your previous turn was interrupted before any user-visible answer text.',
  'Write the final answer now. Do not restart unrelated tasks.',
  'Do not claim you created/updated Notion pages or invent Notion URLs unless a tool result in this thread already returned that URL.',
].join(' ');

export function markdownTableSeamPrefix(content: string): string {
  const tail = content.trimEnd();
  const lastLine = tail.split('\n').pop() ?? '';
  return /^\s*\|.*\|\s*$/.test(lastLine) ? '\n' : '';
}

export function assistantHasProcessOrThought(message: Message): boolean {
  return Boolean(
    message.reasoning?.trim() ||
      message.activity?.length ||
      message.toolRuns?.length,
  );
}

export type ResumeGateResult =
  | { ok: false }
  | { ok: true; emptyInterrupted: boolean };

/** Soft gate for Continue — force bypasses truncation checks. */
export function gateResumeIncompleteReply(
  last: Message | undefined,
  opts?: { force?: boolean; isLoading?: boolean },
): ResumeGateResult {
  if (opts?.isLoading || !last || last.role !== 'assistant') return { ok: false };

  const emptyInterrupted = Boolean(last.incomplete && !last.content.trim());

  if (!opts?.force && !emptyInterrupted) {
    if (!last.content.trim()) return { ok: false };
    const verdict = analyzeTruncation(
      last.content,
      last.finishReason,
      last.incomplete,
      last.truncationReason,
    );
    if (!verdict.truncated) {
      const failedTools = (last.toolRuns || []).some(
        (r) => r.status === 'done' && Boolean(r.error),
      );
      if (!failedTools || !looksAbruptlyCutOff(last.content).truncated) {
        return { ok: false };
      }
    }
  }

  if (
    opts?.force &&
    !last.content.trim() &&
    !last.reasoning?.trim() &&
    !last.toolRuns?.length
  ) {
    return { ok: false };
  }

  return { ok: true, emptyInterrupted };
}

export type ResumeBranch =
  /** Empty bubble, no process yet — wipe & re-answer from prior turns. */
  | 'reanswer_empty'
  /** Empty content but Thought/tools already ran — ask for visible answer. */
  | 'answer_after_process'
  /** Normal continue (optionally with pollution steer). */
  | 'continue';

export function pickResumeBranch(
  last: Message,
  lastUser: Message | undefined,
  emptyInterrupted: boolean,
): ResumeBranch {
  const hasProcess = assistantHasProcessOrThought(last);
  if (emptyInterrupted && lastUser && !hasProcess) return 'reanswer_empty';
  if (emptyInterrupted && lastUser && hasProcess) return 'answer_after_process';
  return 'continue';
}

export function resumeIsPolluted(lastUser: Message | undefined, last: Message): boolean {
  return Boolean(lastUser) && assistantMismatchesUserTopic(lastUser!.content, last.content);
}

export function pollutedContinueUserContent(previousAssistant: string, continuationPrompt: string): string {
  return [
    'Continue THIS conversation only from where the assistant reply stopped.',
    "Do not restart the answer, and do not continue any other chat's tasks, workspace scans, refactors, or tool plans.",
    'Do not mention filesystems, shell, or scanning a workspace unless the user asked for that.',
    continuationPrompt,
  ].join('\n\n');
}

export type ResumeStreamPlan =
  | {
      kind: 'reanswer_empty';
      /** Wipe Thought/tools on the empty bubble before streaming. */
      clearProcess: true;
      /** API thread excludes the empty assistant message. */
      excludeLastAssistant: true;
      initialContent: '';
      seamPrefix: '';
      passWebSources: true;
    }
  | {
      kind: 'answer_after_process';
      extraUserContent: string;
      initialContent: '';
      seamPrefix: '';
      passWebSources: false;
    }
  | {
      kind: 'continue';
      polluted: boolean;
      extraUserContent: string;
      initialContent: string;
      seamPrefix: string;
      passWebSources: false;
    };

/** Plan the Continue stream payload after gate + branch selection. */
export function buildResumeStreamPlan(opts: {
  last: Message;
  lastUser: Message | undefined;
  emptyInterrupted: boolean;
}): ResumeStreamPlan {
  const { last, lastUser, emptyInterrupted } = opts;
  const branch = pickResumeBranch(last, lastUser, emptyInterrupted);

  if (branch === 'reanswer_empty') {
    return {
      kind: 'reanswer_empty',
      clearProcess: true,
      excludeLastAssistant: true,
      initialContent: '',
      seamPrefix: '',
      passWebSources: true,
    };
  }

  if (branch === 'answer_after_process') {
    return {
      kind: 'answer_after_process',
      extraUserContent: EMPTY_AFTER_PROCESS_PROMPT,
      initialContent: '',
      seamPrefix: '',
      passWebSources: false,
    };
  }

  const polluted = resumeIsPolluted(lastUser, last);
  const continuation = buildContinuationPrompt(last.content);
  const seamPrefix = markdownTableSeamPrefix(last.content);
  if (polluted && lastUser) {
    return {
      kind: 'continue',
      polluted: true,
      extraUserContent: pollutedContinueUserContent(last.content, continuation),
      initialContent: last.content,
      seamPrefix,
      passWebSources: false,
    };
  }
  return {
    kind: 'continue',
    polluted: false,
    extraUserContent: continuation,
    initialContent: last.content,
    seamPrefix,
    passWebSources: false,
  };
}

/** Cleared empty-assistant patch for reanswer_empty before streaming. */
export function clearedEmptyAssistant(message: Message): Message {
  return {
    ...message,
    content: '',
    reasoning: undefined,
    activity: undefined,
    toolRuns: undefined,
    incomplete: true,
    truncationReason: undefined,
    finishReason: undefined,
  };
}
