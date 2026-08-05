/**
 * Top-level orchestration: the single entry point chat rendering calls to
 * turn raw model markdown into something remark-math/KaTeX can render safely.
 */
import { fixGreedyAutolinks } from '@/lib/markdown/core/autolinks';
import { normalizeAsciiArtMarkdown } from '@/lib/markdown/core/ascii-art';
import {
  reflowCollapsedMarkdownBlocks,
  reflowCollapsedMarkdownTablesOnly,
} from '@/lib/markdown/core/blocks';
import { normalizeMermaidMarkdown } from '@/lib/markdown/core/mermaid';
import { escapeIncompleteBlockMath, escapeIncompleteInlineMath } from './truncate';
import { hasUnclosedDisplayMath } from './detect';
import { escapeCurrencyDollars, fixBoldWrappedUrls, fixFlankingEmphasis } from './emphasis';
import { liftQuotedMathBlocks, normalizeMathDelimiters } from './normalize';

export function prepareChatMarkdown(
  content: string,
  opts?: { streaming?: boolean; reflowBlocks?: boolean },
): string {
  let out = normalizeMathDelimiters(String(content || ''));
  out = liftQuotedMathBlocks(out);
  // Flanking first (while `$` is still raw), then escape currency for remark-math.
  out = fixFlankingEmphasis(out);
  out = fixBoldWrappedUrls(out);
  // After bold-URL rewrite: stop bare GFM autolinks from swallowing glued CJK.
  out = fixGreedyAutolinks(out);
  out = escapeCurrencyDollars(out);
  // Before remark parses: inline diagram code loses newlines (CommonMark), and
  // language-less Mermaid fences cannot reach the Mermaid renderer.
  out = normalizeAsciiArtMarkdown(out);
  out = normalizeMermaidMarkdown(out);
  // GLM often collapses block markdown (headings/lists/hrs/tables) into one
  // paragraph — restore line breaks so remark can parse structure.
  // Thought/CoT opts out of the prose-level rules (English verifier text is
  // easily shredded) but still gets table recovery: a model that puts its
  // tables in reasoning would otherwise show them as raw pipes.
  out =
    opts?.reflowBlocks === false
      ? reflowCollapsedMarkdownTablesOnly(out)
      : reflowCollapsedMarkdownBlocks(out);

  // Unclosed $$ must be escaped for display — otherwise remark-math swallows the
  // rest of the message into one giant math/“quote-looking” block (even after
  // the stream has ended and Continue is showing “Unclosed math block”).
  const oddBlockMath = hasUnclosedDisplayMath(out);
  if (opts?.streaming || oddBlockMath) {
    out = escapeIncompleteBlockMath(out);
  }
  if (opts?.streaming) {
    out = escapeIncompleteInlineMath(out);
  }
  return out;
}

/**
 * Quote chips only need readable math — skip ascii/mermaid fencing, table
 * restore, and other answer-oriented rewrites that inflate CodeBlock chrome.
 */
export function prepareQuoteMarkdown(content: string): string {
  let out = normalizeMathDelimiters(String(content || ''));
  out = liftQuotedMathBlocks(out);
  out = fixFlankingEmphasis(out);
  out = fixBoldWrappedUrls(out);
  out = fixGreedyAutolinks(out);
  out = escapeCurrencyDollars(out);
  if (hasUnclosedDisplayMath(out)) {
    out = escapeIncompleteBlockMath(out);
  }
  return out;
}

/**
 * Shrink quote previews: turn lone $$…$$ formulas into inline $…$
 * (keeps \begin{…} display blocks). Cuts KaTeX display margins in quote chips.
 */
export function compactQuoteMath(content: string): string {
  return String(content || '').replace(/\$\$([\s\S]*?)\$\$/g, (full, expr) => {
    const inner = String(expr).trim();
    if (!inner) return full;
    if (/\\begin\{/.test(inner)) return `\n$$\n${inner}\n$$\n`;
    return `$${inner.replace(/\s*\n\s*/g, ' ')}$`;
  });
}
