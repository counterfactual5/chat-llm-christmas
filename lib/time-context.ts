/**
 * Authoritative wall-clock context for prompts + search query enrichment.
 * Without this, “最近/latest” collapses toward the model’s training cutoff.
 */

export type ClockContext = {
  timeZone: string;
  isoDate: string;
  year: number;
  month: number;
  day: number;
  weekdayEn: string;
  displayEn: string;
  displayZh: string;
};

export type Freshness = 'day' | 'week' | 'month' | 'year';

const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const WEEKDAYS_ZH = ['日', '一', '二', '三', '四', '五', '六'] as const;

function partsInZone(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'long',
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') bag[p.type] = p.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    weekdayEn: bag.weekday || '',
  };
}

export function getClockContext(timeZone = 'Asia/Shanghai', now = new Date()): ClockContext {
  const { year, month, day, weekdayEn } = partsInZone(now, timeZone);
  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const weekdayZh = WEEKDAYS_ZH[new Date(`${isoDate}T12:00:00+08:00`).getDay()] || '';
  return {
    timeZone,
    isoDate,
    year,
    month,
    day,
    weekdayEn,
    displayEn: `${weekdayEn}, ${MONTHS_EN[month - 1]} ${day}, ${year}`,
    displayZh: `${year}年${month}月${day}日 星期${weekdayZh}`,
  };
}

export function timeContextSystemPrompt(ctx: ClockContext = getClockContext()): string {
  return [
    `Current date/time (authoritative): ${ctx.displayEn} / ${ctx.displayZh} (${ctx.isoDate}, ${ctx.timeZone}).`,
    `Each user/assistant message is prefixed with its real send time in ${ctx.timeZone} (e.g. [2026-07-26 13:05 +08:00]).`,
    `Interpret relative time words (最近/最新/本周/today/this week/recent/latest) relative to the Current date/time and each message’s stamp — never relative to your training cutoff.`,
    `When citing “recent” facts, prefer sources from ${ctx.year} (ideally the last few weeks).`,
    `If search hits are clearly stale (e.g. 2023–2024 articles when today is ${ctx.isoDate}), say they are outdated and do not present them as this week’s news.`,
  ].join(' ');
}

/** Compact wall-clock stamp for a message, e.g. "2026-07-26 13:05 +08:00". */
export function formatMessageStamp(timestampMs: number, timeZone = 'Asia/Shanghai'): string {
  const d = new Date(timestampMs);
  if (!Number.isFinite(d.getTime())) return '';
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== 'literal') bag[p.type] = p.value;
  }
  // en-CA gives YYYY-MM-DD; hour may be "24" in some engines at midnight — normalize.
  const hour = bag.hour === '24' ? '00' : bag.hour;
  return `${bag.year}-${bag.month}-${bag.day} ${hour}:${bag.minute} +08:00`;
}

const STAMP_RE = /^\[\d{4}-\d{2}-\d{2}[^\]]*\]\s*/;

/** Strip a leading [timestamp] prefix if present (for search query extraction). */
export function stripMessageStamp(text: string): string {
  return String(text || '').replace(STAMP_RE, '');
}

/**
 * Prefix message body with its send time. Idempotent if already stamped.
 * Does not mutate UI-stored content — call only on the API payload path.
 */
export function stampMessageText(
  text: string,
  timestampMs?: number | null,
  timeZone = 'Asia/Shanghai',
): string {
  const body = String(text || '');
  if (!body.trim()) return body;
  if (STAMP_RE.test(body.trimStart())) return body;
  const ts =
    typeof timestampMs === 'number' && Number.isFinite(timestampMs)
      ? timestampMs
      : Date.now();
  const stamp = formatMessageStamp(ts, timeZone);
  if (!stamp) return body;
  return `[${stamp}] ${body}`;
}

export function looksTemporalQuery(text: string): boolean {
  return /最近|最新|本周|这周|上周|本月|这个月|今日|今天|今晚|近期|刚刚|今年|过去\s*\d+|this\s+week|last\s+week|today|tonight|recent|latest|past\s+\d+|yesterday|this\s+month|last\s+month/i.test(
    String(text || ''),
  );
}

/** Map natural-language recency to provider freshness windows. */
export function freshnessForQuery(text: string): Freshness | null {
  const t = String(text || '');
  if (!t.trim()) return null;
  if (/今日|今天|今晚|昨晚|yesterday|today|tonight|过去\s*24|last\s*24|past\s*day/i.test(t)) {
    return 'day';
  }
  if (
    /本周|这周|上周|一周|7\s*天|this\s+week|last\s+week|past\s+week|past\s+7/i.test(t)
  ) {
    return 'week';
  }
  if (/本月|这个月|上月|30\s*天|this\s+month|last\s+month|past\s+month/i.test(t)) {
    return 'month';
  }
  if (/今年|this\s+year|过去\s*一?年|past\s+year/i.test(t)) return 'year';
  if (/最近|最新|近期|recent|latest|刚|刚刚/.test(t)) return 'week';
  return null;
}

/**
 * Append explicit calendar anchors so search engines don’t drift to training-era pages.
 */
export function enrichSearchQuery(query: string, ctx: ClockContext = getClockContext()): string {
  const q = String(query || '').trim();
  if (!q) return q;

  const fresh = freshnessForQuery(q);
  if (!fresh && !looksTemporalQuery(q)) return q.slice(0, 240);

  const monthEn = MONTHS_EN[ctx.month - 1];
  const ym = `${ctx.year}-${String(ctx.month).padStart(2, '0')}`;
  const alreadyAnchored =
    q.includes(ctx.isoDate) ||
    q.includes(ym) ||
    new RegExp(`\\b${ctx.year}\\b`).test(q);

  let suffix = '';
  if (fresh === 'day') suffix = `${ctx.isoDate} today`;
  else if (fresh === 'week') suffix = `${ym} past week ${ctx.year}`;
  else if (fresh === 'month') suffix = `${monthEn} ${ctx.year}`;
  else if (fresh === 'year') suffix = String(ctx.year);
  else suffix = `${monthEn} ${ctx.year}`;

  if (alreadyAnchored && q.toLowerCase().includes('past week')) return q.slice(0, 240);
  if (alreadyAnchored) return q.slice(0, 240);
  return `${q} ${suffix}`.trim().slice(0, 240);
}

export function englishRecencyQuery(
  topic: string,
  ctx: ClockContext = getClockContext(),
  fresh: Freshness = 'week',
): string {
  const monthEn = MONTHS_EN[ctx.month - 1];
  if (fresh === 'day') return `${topic} ${ctx.isoDate} today`.slice(0, 240);
  if (fresh === 'month') return `${topic} ${monthEn} ${ctx.year}`.slice(0, 240);
  if (fresh === 'year') return `${topic} ${ctx.year}`.slice(0, 240);
  return `${topic} ${monthEn} ${ctx.year} past week`.slice(0, 240);
}
