/** Max quoted selection chips that can ride along with one send. */
export const MAX_QUOTED_SELECTIONS = 8;

/** Encode one or more quotes as Markdown blockquotes ahead of the user body. */
export function formatQuotedMessage(userText: string, quotes: string | string[]): string {
  const list = (Array.isArray(quotes) ? quotes : [quotes])
    .map((q) => q.trim())
    .filter(Boolean);
  const body = userText.trim();
  if (!list.length) return body;
  const blocks = list
    .map((q) =>
      q
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n'),
    )
    .join('\n\n');
  return body ? `${blocks}\n\n${body}` : blocks;
}

/** Split a sent user message that was built by formatQuotedMessage into quotes + body. */
export function parseQuotedUserMessage(content: string): { quotes: string[]; body: string } {
  const text = String(content || '');
  if (!text.startsWith('>')) return { quotes: [], body: text };
  const lines = text.split('\n');
  const quotes: string[] = [];
  let current: string[] = [];
  let i = 0;

  const flush = () => {
    const q = current.join('\n').trim();
    if (q) quotes.push(q);
    current = [];
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('> ') || line === '>') {
      current.push(line.startsWith('> ') ? line.slice(2) : '');
      continue;
    }
    if (line.trim() === '') {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j += 1;
      if (j < lines.length && (lines[j].startsWith('> ') || lines[j] === '>')) {
        flush();
        i = j - 1;
        continue;
      }
      flush();
      i = j;
      break;
    }
    flush();
    break;
  }
  while (i < lines.length && lines[i].trim() === '') i += 1;
  return {
    quotes,
    body: lines.slice(i).join('\n'),
  };
}

/** Append a new quote chip, de-duping and capping at MAX_QUOTED_SELECTIONS. */
export function appendQuotedSelection(prev: string[], clean: string): string[] {
  if (!clean) return prev;
  if (prev.some((q) => q === clean)) return prev;
  if (prev.length >= MAX_QUOTED_SELECTIONS) {
    return [...prev.slice(1), clean];
  }
  return [...prev, clean];
}
