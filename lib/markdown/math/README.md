# lib/markdown/math

Math-aware markdown helpers for chat streaming + quotes. Split by feature;
`index.ts` re-exports everything so `@/lib/markdown/math` stays stable.

| Module | Responsibility |
|--------|----------------|
| `shared.ts` | `MATH_ENVIRONMENTS`, `mapOutsideFences` — internal fence-protection helper |
| `normalize.ts` | `\[...\]`/`\(...\)`/bare `\begin{…}` → `$`/`$$`; lift quoted math blocks |
| `detect.ts` | Pure detection: unclosed `$$` count/parity, truncated-math heuristic |
| `truncate.ts` | Streaming: escape a trailing unclosed `$$`/`$` so KaTeX never sees a partial expression |
| `emphasis.ts` | `**bold**` vs CJK punctuation / currency `$` fixups |
| `prepare.ts` | `prepareChatMarkdown` (entry point) + `compactQuoteMath` (quote preview shrink) |
| `katex-dom.ts` | Browser-only: recover TeX source from rendered KaTeX DOM/selection |
| `index.ts` | Public barrel (`@/lib/markdown/math`) |
