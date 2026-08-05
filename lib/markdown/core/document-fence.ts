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

const FENCE_LANG =
  'bash|sh|zsh|shell|powershell|cmd|console|python|py|javascript|js|typescript|ts|json|yaml|yml|text|txt|sql|rust|go|java|c|cpp|html|css|xml|md|markdown|diff|dockerfile|ini|toml|ruby|php|swift|kotlin|r';

/**
 * When GLM collapses newlines, a one-line fence often appears as:
 * - ` ```D:\\ComfyUI\\models\\``` ` — meant as a path (inline code)
 * - ` ```bash git clone …``` ` — language + body jammed; restore a real fence
 * Multi-line fences are left alone.
 */
export function normalizeSameLineFences(content: string): string {
  return String(content || '').replace(/```([^\n`]+)```/g, (full, body: string, offset: number, whole: string) => {
    const raw = String(body || '');
    const t = raw.trim();
    if (!t) return full;

    const leadBreak =
      offset > 0 && whole[offset - 1] !== '\n' ? '\n\n' : '';

    // Windows / Unix path — demote to inline code.
    if (/^[A-Za-z]:[\\/]/.test(t) || /^[~\/](?:[\w.-]+[\\/])+/.test(t)) {
      return `\`${t}\``;
    }

    // `bash git clone …` / `python print(1)` jammed on one line.
    const langBody = t.match(
      new RegExp(String.raw`^(${FENCE_LANG})\s+(\S[\s\S]*)$`, 'i'),
    );
    if (langBody) {
      // Trailing newline after the closer so following prose is not swallowed
      // into an unclosed fence (` ```这样你本地 `).
      return `${leadBreak}\`\`\`${langBody[1]}\n${langBody[2]!.trim()}\n\`\`\`\n`;
    }

    // Numbered steps jammed into a language-less same-line fence
    // (` ``` 1. foo 2. bar ``` `) — restore a real block so lists can reflow.
    if (/(?:^|\s)\d{1,2}\.\s+\S/.test(t) && t.length >= 16) {
      return `${leadBreak}\`\`\`\n${t}\n\`\`\`\n`;
    }

    return full;
  });
}

/**
 * Closing ``` glued to following prose (` ```这样你本地 `) leaves the fence
 * open in CommonMark and swallows the rest of the answer. Break only when the
 * trailing token is not a language info string.
 */
export function breakProseGluedToClosingFence(content: string): string {
  return String(content || '').replace(
    /(^|\n)(```)[ \t]*([^\n`]+)/gm,
    (full, lead: string, fence: string, rest: string) => {
      const info = rest.trim();
      // Opening fence with a language/info tag: ```bash / ```md / ```c++
      if (/^[a-zA-Z][\w.+#-]*(?:\s|$)/.test(info)) {
        return full;
      }
      // Anything else after ``` on the same line is glued prose (often CJK).
      return `${lead}${fence}\n\n${rest}`;
    },
  );
}
