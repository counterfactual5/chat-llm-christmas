/**
 * Client-side reply truncation / Continue helpers.
 * Builds on provider finish_reason signals in `@/lib/chat/stream/truncation`.
 */

import {
  hasUnclosedDisplayMath,
  looksLikeTruncatedMath,
} from '@/lib/markdown/math';
import {
  contentHasThinkMarkup,
  extractThinkBlocks,
} from '@/lib/chat/message/think-tags';
import {
  NATURAL_FINISH_REASONS,
  SOFT_TRUNCATION_REASONS,
  truncationFromFinishReason,
} from '@/lib/chat/stream/truncation';

export type TruncationHints = {
  /** Server sent truncated=true/false on the completion event. */
  serverTruncated?: boolean | null;
  serverReason?: string;
};

/** Body ends mid-structure even when the provider reported stop. */
export function looksAbruptlyCutOff(content: string): { truncated: boolean; reason: string } {
  const text = (content || '').trimEnd();
  if (!text) return { truncated: false, reason: '' };
  // Trailing markdown heading with no body under it.
  if (/(?:^|\n)#{1,6}[ \t]+[^\n]*\s*$/.test(text)) {
    return { truncated: true, reason: 'Stopped mid-section' };
  }
  // Introduced a list/section with a colon then nothing.
  if (/[:：]\s*$/.test(text)) {
    return { truncated: true, reason: 'Stopped mid-sentence' };
  }
  // Dangling list marker.
  if (/(?:^|\n)(?:[-*+]|\d+\.)\s*$/.test(text)) {
    return { truncated: true, reason: 'Stopped mid-list' };
  }
  // Announced a tool action then stopped ("Let me fetch the current content first.").
  // Caller should suppress this when real toolRuns already succeeded afterward.
  if (
    /(let me (first )?(fetch|read|get|load|search)|I('ll| will) (first )?(fetch|read|get)|先(读|看|获取|拉取|搜)|让我(先)?(读|看|获取|搜)|我先.{0,12}(读|看|获取)).{0,40}$/i.test(
      text,
    )
  ) {
    return { truncated: true, reason: 'Stopped before calling tools' };
  }
  return { truncated: false, reason: '' };
}

/** Retrieval tools that mean "Stopped before calling tools" is stale. */
export function hasSuccessfulRetrievalTools(
  toolRuns?: Array<{ name?: string; status?: string; error?: string }>,
): boolean {
  return (toolRuns || []).some(
    (r) =>
      r.status === 'done' &&
      !r.error &&
      /web_search|web_read|web-read|proactive_search|image_understand/i.test(
        String(r.name || ''),
      ),
  );
}

/**
 * Decide whether a reply was cut off.
 * Prefer: stored hard reason → server truncated flag → finish_reason →
 * structural (code/math/think) → abrupt body → incomplete flag.
 * Do NOT guess from “工具/工作区” body text — that false-triggers Continue.
 */
export function analyzeTruncation(
  content: string,
  finishReason?: string | null,
  incomplete?: boolean,
  storedReason?: string,
  hints?: TruncationHints,
): { truncated: boolean; reason: string } {
  const text = (content || '').trimEnd();
  if (!text) return { truncated: false, reason: '' };

  // Sticky only for hard reasons. Soft legacy reasons are revalidated below.
  if (storedReason && !SOFT_TRUNCATION_REASONS.has(storedReason)) {
    return { truncated: true, reason: storedReason };
  }

  // Authoritative server completion event.
  if (hints?.serverTruncated === true) {
    return {
      truncated: true,
      reason: hints.serverReason || truncationFromFinishReason(finishReason).reason || 'Reply was interrupted',
    };
  }
  if (hints?.serverTruncated === false) {
    // Still honor strong structural cuts (model said stop but left an open fence / dangling heading).
    const structural = structuralTruncation(text, finishReason);
    if (structural.truncated) return structural;
    const abrupt = looksAbruptlyCutOff(text);
    if (abrupt.truncated) return abrupt;
    return { truncated: false, reason: '' };
  }

  const fromFinish = truncationFromFinishReason(finishReason);
  if (fromFinish.truncated) {
    return fromFinish;
  }

  const structural = structuralTruncation(text, finishReason);
  if (structural.truncated) return structural;

  // Provider said stop/end_turn but the body clearly dies mid-section
  // (common after a failed tool when the model starts a rewrite outline).
  const abrupt = looksAbruptlyCutOff(text);
  if (abrupt.truncated) return abrupt;

  // User hit Stop / page refreshed mid-stream / connection dropped.
  // Do not honor incomplete when it was only paired with a soft legacy reason
  // (e.g. false “Stopped while trying to use tools” on a finished answer).
  if (incomplete) {
    if (storedReason && SOFT_TRUNCATION_REASONS.has(storedReason)) {
      return { truncated: false, reason: '' };
    }
    if (finishReason && NATURAL_FINISH_REASONS.has(finishReason)) {
      // Natural finish + incomplete is often a stale flag; keep abrupt/structural only.
      return { truncated: false, reason: '' };
    }
    return { truncated: true, reason: 'Reply was interrupted' };
  }

  return { truncated: false, reason: '' };
}

export function structuralTruncation(
  text: string,
  finishReason?: string | null,
): { truncated: boolean; reason: string } {
  if ((text.match(/```/g) || []).length % 2 === 1) {
    return { truncated: true, reason: 'Unclosed code block' };
  }
  // Odd $$ is often a false positive when the model *talks about* LaTeX
  // (“同一个 $$ 块”). Only Continue when the tail still looks like cut-off math,
  // or the provider did not report a clean natural stop.
  if (hasUnclosedDisplayMath(text)) {
    const naturalStop = !finishReason || NATURAL_FINISH_REASONS.has(finishReason);
    const endsLikeSentence = /[.!?。！？…]\s*$/.test(text);
    if (looksLikeTruncatedMath(text) || !naturalStop || !endsLikeSentence) {
      return { truncated: true, reason: 'Unclosed math block' };
    }
  }
  {
    const { content: visible, reasoning } = extractThinkBlocks(text);
    if (
      contentHasThinkMarkup(text) &&
      /<think\b|<thinking\b/i.test(text) &&
      !/<\/(?:think|thinking)>/i.test(text)
    ) {
      return { truncated: true, reason: 'Unclosed thinking block' };
    }
    // Long thinking then only a short bridge sentence — usually cut before the real answer.
    if (reasoning.length > 80 && visible.trim().length > 0 && visible.trim().length < 180) {
      return { truncated: true, reason: 'Stopped before finishing the answer' };
    }
  }
  return { truncated: false, reason: '' };
}

/** Heuristic: partial reply is stuck narrating IDE/agent tool use (Continue prompt only). */
export function looksLikeToolNarration(text: string): boolean {
  // Negated limits (“不能扫描工作区”) are capability disclaimers, not agent narration.
  if (
    /不能[^。\n]{0,40}(?:工作区|workspace|shell)|无法[^。\n]{0,40}(?:工作区|workspace)|do not (?:read|scan)|cannot read local/i.test(
      text,
    )
  ) {
    return false;
  }
  // Require IDE/workspace agent narration — bare "tool_call" matches Agent docs
  // and Notion workflow templates, which wrongly wiped Continue mid-reply.
  return /正在扫描(?:工作区|项目|仓库)|改用\s*shell|同步\s*I\/O|扫描工作区|定位同步|Shell\s+扫描|异步重构|排查工作区|<(?:tool_call|tool_calls|function_call)\b/i.test(
    text,
  );
}

/** Assistant is continuing a coding/agent task that doesn't match this chat's last user ask. */
export function assistantMismatchesUserTopic(userText: string, assistantText: string): boolean {
  if (!looksLikeToolNarration(assistantText)) return false;
  // Same-chat coding asks may legitimately mention workspace — don't treat as cross-bleed.
  if (
    /async|python|refactor|代码|工作区|workspace|shell|文件|bug|报错|debug|重构|notion|模板|template|agent/i.test(
      userText,
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Continuation instructions tailored to whatever structure the reply was cut
 * inside, so the model resumes the same table / code block / formula instead of
 * restarting it with a fresh header.
 */
export function buildContinuationPrompt(previous: string): string {
  const text = previous.trimEnd();
  const tail = text.slice(-400);
  const lines = text.split('\n');
  const lastLine = lines[lines.length - 1] ?? '';

  const rules: string[] = [
    'Continue your previous reply from exactly where it stopped.',
    'Your output is appended directly to the previous text, so do not repeat any sentence, row, or heading you already wrote, do not restart the answer, and do not add an intro or apology.',
  ];

  const insideCodeBlock = (text.match(/```/g) || []).length % 2 === 1;
  const insideMath = (text.match(/\$\$/g) || []).length % 2 === 1;
  const insideTable = /^\s*\|/.test(lastLine);
  const toolStuck = looksLikeToolNarration(text);

  if (toolStuck) {
    rules.push(
      'You previously tried to use workspace/shell/search tools that are NOT available in this web chat.',
      'Do not continue scanning files, running shell, or emitting tool_call markup.',
      'Stop the tool narration and answer the user\'s original request directly with what you know.',
    );
  }

  if (insideCodeBlock) {
    rules.push(
      'You stopped inside a fenced code block. Continue the code directly with no new opening fence, and close it with ``` when the code is finished.',
    );
  }
  if (insideMath) {
    rules.push(
      'You stopped inside a $$ math block. Continue the LaTeX from that exact point and close the block with $$. Never open a new $$ block for this formula.',
    );
  }
  if (insideTable) {
    rules.push(
      'You stopped inside a Markdown table. Emit only the remaining data rows, starting immediately with a newline followed by |. Do not repeat the header row, do not emit another |---| separator row, and do not repeat the last row shown below.',
    );
  }
  if (!insideCodeBlock && !insideMath && !insideTable && !toolStuck) {
    rules.push(
      'If the text was cut mid-sentence or mid-word, resume from that exact character.',
    );
  }

  return `${rules.join('\n')}\n\nHere are the last characters you wrote — continue immediately after them:\n\n<<<TAIL\n${tail}\nTAIL>>>`;
}
