---
title: "fix: Join short CJK hard-wraps in answer markdown"
date: 2026-08-06
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
plan_type: fix
---

# fix: Join short CJK hard-wraps in answer markdown

## Goal Capsule

Make mid-sentence Chinese hard wraps in assistant answers (especially structured `/review` reports) display as continuous prose, without changing Review generation prompts or Process cards.

**Stop when:** short CJK continuation lines join like long ones; poem-like short lines and real markdown blocks stay unjoined; `tests/chat/markdown-blocks.test.ts` covers both; CSS changes only if join alone cannot fix the reported shredding.

**Authority:** session-settled — user chose hard-wrap / wrap fix only (not Process labels); confirmed Review already reuses `AnswerMarkdown` / `prepareChatMarkdown`.

---

## Product Contract

### Summary

Strengthen the shared answer-markdown hard-wrap joiner so Review-shaped CJK reports stop looking chopped mid-sentence, while normal continuous chat stays unchanged.

### Problem Frame

Manual `/review` streams a structured Markdown report through the same `AnswerMarkdown` → `prepareChatMarkdown` → `reflowCollapsedMarkdownBlocks` → `unwrapHardWrappedProse` path as normal answers. Exported `.md` can look fine. On screen, models writing report prose often insert single-newline hard wraps mid-CJK; `shouldJoinHardWrap` only joins when the previous line’s non-space length is ≥ 36 (plus a few mid-word specials). Short wraps stay as separate lines, and `<p className="whitespace-pre-wrap">` makes them visible — stacked fragments that look “格式混乱.” Normal chat rarely emits that wrap shape, so it looks fine on the same renderer.

### Requirements

- R1. Mid-sentence CJK hard wraps that are continuations of the previous line must join into one prose line before remark parses.
- R2. Preserve intentional short lines: poem-like stacks, list/heading/table/fence block starts, and existing “do not glue code span onto 第二步” cases.
- R3. Do not change `/review` system prompts, Process card copy, or Research busy/Stop behavior.
- R4. Prefer fixing join logic in `lib/markdown/core/blocks.ts` (shared by all `AnswerMarkdown` consumers). Touch `AnswerMarkdown` CSS (`whitespace-pre-wrap` / `overflow-wrap`) only if join alone cannot reproduce a continuous paragraph for the failure fixtures.
- R5. Lock behavior with unit tests on the reflow helper; no requirement for full browser E2E.

### Key Decisions (product)

- Same renderer for Review and normal answers — fix the shared join/reflow, not a Review-only UI fork.
- Generation prompt changes are out of scope for this plan.

### Actors / Flows

- A1 User — reads streaming or finished assistant markdown, including `/review` reports.
- F1 Stream or reload an answer whose model text contains mid-CJK `\n` wraps → prose reads continuously.
- F2 Short poem-like or list-structured lines → still one line per intended break.

### Acceptance Examples

- AE1. A review-like paragraph hard-wrapped into lines of ~18–30 CJK chars (below today’s 36 threshold) joins into one paragraph after reflow.
- AE2. Existing fixture `does not join short poem-like CJK lines` still passes.
- AE3. Mid-word wrap `**备选方**\n案，` and long-line wrap (≥36) fixtures still join; closed `` `_intel` `` + `第二步` still does not glue.

---

## Planning Contract

### Key Technical Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| **KTD1** (session-settled: user-directed — chosen over Process + wrap bundle) | Scope = hard-wrap / CJK wrap only | User confirmed option 1. |
| **KTD2** | Fix in `shouldJoinHardWrap` / `unwrapHardWrappedProse` first; keep poem + block-start guards | Root cause is join threshold vs wrap shape; CSS is a blunt second lever. |
| **KTD3** | Do not invent a Review-only markdown path | Review already reuses answer parsing; a fork would drift. |
| **KTD4** | New tests extend `tests/chat/markdown-blocks.test.ts` | Existing hard-wrap / poem coverage lives there. |
| **KTD5** | Defer CSS (`whitespace-pre-wrap` / `overflow-wrap:anywhere`) to U2 only if U1 fixtures still fail visually | Avoid regressing intentional preserved newlines and table/code wrapping. |

### Assumptions

- Failure mode is primarily preserved single newlines inside a paragraph, not a separate Review renderer bug.
- Lowering or refining the ≥36 rule must keep the poem fixture green — threshold-only changes without a “continuation” signal are insufficient.

### Scope Boundaries

#### In scope

- CJK hard-wrap join heuristics + tests.
- Optional AnswerMarkdown wrap CSS if U1 proven insufficient.

#### Out of scope / Deferred to Follow-Up Work

- Process card stage labels (“Searching the web…” during report write).
- `MANUAL_REVIEW_RESPONSE_SYSTEM` / report outline prompt edits.
- Thought / CoT path (`reflowBlocks={false}`).
- QuoteMarkdown / composer quotes.

### Risks

- Over-joining short intentional lines (poems, dialogue beats) — mitigate with punct/block guards + keep poem test.
- Changing `overflow-wrap` globally may affect long URLs or Latin — gate behind U2 evidence.

---

## Implementation Units

### U1. Strengthen CJK hard-wrap join + tests

**Goal:** Join short mid-sentence CJK continuations that today’s `prevLen >= 36` rule misses, without merging poems or real blocks.

**Requirements:** R1, R2, R3, R5 — KTD1–KTD4 — Covers AE1–AE3

**Dependencies:** none

**Files:**
- Modify `lib/markdown/core/blocks.ts` (`shouldJoinHardWrap` / helpers used by `unwrapHardWrappedProse`)
- Modify `tests/chat/markdown-blocks.test.ts`

**Approach:**
1. Characterize short hard-wrap as “previous line ends mid-prose (CJK or open emphasis), next line continues CJK/Latin, next is not a markdown block start.”
2. Extend join beyond the rigid ≥36 gate (lower threshold and/or sentence-final punct / block-start negatives) while keeping existing mid-word specials.
3. Add a fixture modeled on review report prose: several consecutive short CJK wrap lines that must become one paragraph; keep poem + Step mid-word + `` `_intel` `` cases.

**Execution note:** Extend characterization coverage in `markdown-blocks.test.ts` before widening the join rule; keep the poem case red/green as the over-join guard.

**Patterns to follow:** Comments and fixtures already in `shouldJoinHardWrap` / `joins long hard-wrapped CJK prose lines` / `does not join short poem-like CJK lines` in `tests/chat/markdown-blocks.test.ts`.

**Test scenarios:**
- Happy path: three ~20-char CJK wrap lines of one sentence → single joined line after `reflowCollapsedMarkdownBlocks`.
- Happy path: existing long-line (≥36) wrap still joins.
- Edge: poem three short lines → unchanged.
- Edge: list item then short continuation that is a new `-` / `#` / `|` block → not joined.
- Edge: `**备选方**\n案，` still joins; `` `_intel` `` + `第二步` still does not.
- Error/failure: N/A (pure transform).

**Verification:** Targeted vitest file green; spot-check a pasted review-shaped markdown string in UI if convenient (not required for unit Done).

### U2. AnswerMarkdown wrap CSS only if U1 insufficient

**Goal:** If joined text still shreds visually (e.g. `overflow-wrap:anywhere` mid-glyph stacks), adjust prose wrap CSS without abandoning join.

**Requirements:** R4 — KTD5

**Dependencies:** U1

**Files:**
- Modify `components/chat/message/AnswerMarkdown.tsx` only if needed
- Test expectation: none — CSS-only; verify by rendering the U1 fixture string in chat or Story-less manual check

**Approach:**
1. After U1, render the failing review-shaped string through `AnswerMarkdown`.
2. If prose is continuous, skip this unit (no CSS change).
3. If still shredded, prefer the smallest change (`overflow-wrap` policy for prose vs tables) before removing `whitespace-pre-wrap` (which preserves intentional breaks).

**Patterns to follow:** Comment in `AnswerMarkdown` that tables opt out of `overflow-wrap:anywhere`.

**Test scenarios:**
- Test expectation: none -- visual/CSS gate only; U1 owns behavioral lock.

**Verification:** U1 fixture reads as one paragraph in the answer bubble; tables still scroll horizontally.

---

## Verification Contract

- Run `tests/chat/markdown-blocks.test.ts` (project’s usual vitest invocation).
- Confirm poem, mid-word, and new short-wrap fixtures all pass.
- Manual: paste or replay a short hard-wrapped Chinese paragraph in an assistant bubble if CSS unit may fire.

## Definition of Done

- R1–R5 satisfied; AE1–AE3 locked in tests (AE1/AE2/AE3 via U1).
- U2 either skipped with evidence join is enough, or CSS change is minimal and documented in the PR.
- No Process / review-prompt / busy-session changes in the diff.

## Appendix

### Sources & Research

- Local: `lib/markdown/core/blocks.ts`, `lib/markdown/math/prepare.ts`, `components/chat/message/AnswerMarkdown.tsx`, `tests/chat/markdown-blocks.test.ts`, `lib/markdown/README.md`
- Session diagnosis: Review reuses answer markdown; wrap shape differs; export can be continuous while UI shows hard newlines
- External research: skipped — strong local patterns
- Institutional learnings: no `docs/solutions/` corpus
- Subagent research: unavailable this run (usage limit); research performed inline in the planning session
