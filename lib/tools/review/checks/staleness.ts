import type { ExecutionRecordEntry, ReviewCheck, ReviewCheckItem } from '@/lib/tools/review/types';
import {
  collectSources,
  hasWebSearchOrReadReceipt,
  splitSentences,
  stripCodeBlocks,
  yearsIn,
} from '@/lib/tools/review/shared';

const TIME_MARKER_RE =
  /截至|截止|目前|现在|当前|最新|至今|如今|今年|本月|本周|今天|现阶段|as of|currently|latest|to date|right now|today|nowadays/i;

const SUPERLATIVE_RE = /最新|最大|最多|最高|最低|最快|第一|唯一|首个|newest|largest|fastest|best|only/i;

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
