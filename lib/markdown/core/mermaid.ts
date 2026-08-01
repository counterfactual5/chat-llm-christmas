/** Recover Mermaid source that models wrap in inline or language-less fences. */

const MERMAID_START_RE =
  /^\s*(?:flowchart\s+(?:TD|TB|BT|LR|RL)\b|graph\s+(?:TD|TB|BT|LR|RL)\b|sequenceDiagram\b|classDiagram\b|stateDiagram(?:-v2)?\b|erDiagram\b|gantt\b|pie\b|gitGraph\b|mindmap\b|timeline\b|journey\b|quadrantChart\b|xychart-beta\b)/i;

export function looksLikeMermaidSource(text: string): boolean {
  const source = String(text || '').trim();
  if (!MERMAID_START_RE.test(source)) return false;
  // Avoid promoting a prose sentence that merely names a diagram type.
  if (/^(?:flowchart|graph)\b/i.test(source)) {
    return /-->|---|-.->|==>|\[[^\]]+\]|\([^)]*\)|\{[^}]+\}/.test(source);
  }
  return source.includes('\n') || /:|-->|->>|participant\b|section\b/i.test(source);
}

function fenceMermaid(source: string): string {
  return `\n\n\`\`\`mermaid\n${source.trim()}\n\`\`\`\n\n`;
}

/** Language-less fences that clearly contain Mermaid become ```mermaid. */
export function labelUnfencedMermaidBlocks(markdown: string): string {
  return String(markdown || '').replace(
    /```[ \t]*\n([\s\S]*?)\n```/g,
    (full, body: string) => (looksLikeMermaidSource(body) ? fenceMermaid(body).trim() : full),
  );
}

/** Single/double-backtick Mermaid source becomes a proper fenced diagram. */
export function promoteInlineMermaidToFences(markdown: string): string {
  return String(markdown || '')
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((segment, idx) => {
      if (idx % 2 === 1 || segment.startsWith('```')) return segment;
      return segment.replace(
        /(`+)((?:(?!\1)[\s\S])*?)\1/g,
        (full, _ticks: string, body: string) =>
          looksLikeMermaidSource(body) ? fenceMermaid(body) : full,
      );
    })
    .join('');
}

export function normalizeMermaidMarkdown(markdown: string): string {
  return promoteInlineMermaidToFences(labelUnfencedMermaidBlocks(markdown));
}
