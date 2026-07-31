import type { ReviewCheck, ReviewCheckItem, ReviewInput } from '@/lib/tools/review/types';

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
