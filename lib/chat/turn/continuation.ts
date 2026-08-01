/**
 * Continue / claim-review turn planning — pure decisions + prompts.
 * The chat hook still owns streaming / loading; this module answers
 * “may we resume?” and “which resume branch?”.
 */

import type { Message } from '@/lib/chat/types';
import {
  analyzeTruncation,
  assistantMismatchesUserTopic,
  looksAbruptlyCutOff,
} from '@/lib/chat/stream/reply-truncation';

export const CLAIM_REVIEW_USER_PROMPT = [
  'Claim Review: audit your previous assistant answer.',
  'For each claim of a tool action, web search, or factual statement, verify it against the tool results in this conversation.',
  'Retract any claim that lacks a real tool receipt; otherwise confirm it is verified. Be brief.',
].join(' ');

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
