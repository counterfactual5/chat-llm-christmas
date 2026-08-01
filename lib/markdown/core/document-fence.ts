/**
 * Models sometimes wrap an entire Markdown document in a `markdown` fence.
 * That prevents headings, lists, and tables from rendering. Unwrap only when
 * the fence occupies the complete answer; embedded code examples stay intact.
 */
export function unwrapMarkdownDocumentFence(content: string): string {
  const source = String(content || '');
  const match = source.match(/^\s*```(?:markdown|md)\s*\n([\s\S]*?)\n```\s*$/i);
  if (!match) return source;

  const document = match[1] || '';
  // Avoid changing a fenced snippet that merely happens to be labelled markdown.
  const looksLikeDocument =
    /(^|\n)#{1,6}\s+\S/.test(document) ||
    /(^|\n)(?:[-*+] |\d+[.)] )\S/.test(document) ||
    /(^|\n)\|[^\n]+\|\s*\n\|?\s*:?-{3,}/.test(document);
  return looksLikeDocument ? document.trim() : source;
}
