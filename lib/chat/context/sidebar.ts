import type { ChatSession } from '@/lib/chat/types';

export type SidebarDayGroup = {
  key: string;
  sessions: ChatSession[];
  isToday: boolean;
};

/** Local calendar day key (YYYY-MM-DD) for grouping. */
export function dayKeyOf(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Sidebar / day-group sort key: last user send time.
 * Do not use updatedAt — streaming assistant tokens bump it and make concurrent
 * chats jump in the list.
 */
export function sessionLastUserRequestAt(session: ChatSession): number {
  const messages = session.messages || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    const ts = Number(m.timestamp || 0);
    if (ts > 0) return ts;
  }
  return Number(session.updatedAt || 0);
}

/** Sessions with messages, newest user request first (empty drafts stay out of the sidebar). */
export function sessionsForSidebar(sessions: ChatSession[]): ChatSession[] {
  return [...sessions]
    .filter((session) => session.messages.length > 0)
    .sort((a, b) => sessionLastUserRequestAt(b) - sessionLastUserRequestAt(a));
}

export function buildSidebarDayGroups(
  sessions: ChatSession[],
  todayKey = dayKeyOf(Date.now()),
): SidebarDayGroup[] {
  const map = new Map<string, ChatSession[]>();
  for (const session of sessions) {
    const key = dayKeyOf(sessionLastUserRequestAt(session));
    const list = map.get(key);
    if (list) list.push(session);
    else map.set(key, [session]);
  }
  const groups: SidebarDayGroup[] = [...map.entries()].map(([key, list]) => ({
    key,
    sessions: list,
    isToday: key === todayKey,
  }));
  // Keys are YYYY-MM-DD so string desc ≈ chronological desc.
  groups.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  return groups;
}

export function formatDayGroupLabel(
  key: string,
  opts: { todayKey: string; locale: string; todayLabel: string; yesterdayLabel: string },
): string {
  if (key === opts.todayKey) return opts.todayLabel;
  const [ys, ms, ds] = key.split('-').map(Number);
  const date = new Date(ys, ms - 1, ds);
  const yesterday = new Date();
  yesterday.setHours(0, 0, 0, 0);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return opts.yesterdayLabel;
  }
  if (opts.locale === 'zh') {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
