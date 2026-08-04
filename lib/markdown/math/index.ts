/**
 * Math-aware markdown helpers for chat streaming + quotes.
 * Incomplete $$ / $ during stream → plain text (no KaTeX red errors).
 * Blockquote-wrapped display math → lifted so remark-math can parse it.
 *
 * Public barrel — keeps `@/lib/markdown/math` stable while the
 * implementation is split by feature under this folder.
 */
export { normalizeMathDelimiters, liftQuotedMathBlocks } from './normalize';
export {
  countDisplayMathDelimiters,
  hasUnclosedDisplayMath,
  looksLikeTruncatedMath,
} from './detect';
export { escapeIncompleteBlockMath, escapeIncompleteInlineMath } from './truncate';
export { fixFlankingEmphasis, fixBoldWrappedUrls, escapeCurrencyDollars } from './emphasis';
export { prepareChatMarkdown, prepareQuoteMarkdown, compactQuoteMath } from './prepare';
export { texFromKatexElement, markdownFromDomSelection } from './katex-dom';
