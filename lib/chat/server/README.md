# lib/chat/server

Server-only helpers for the chat API. Prefer importing these
directly from here; do not re-export through client chat barrels.

HTTP entry: `app/api/chat/route.ts` (runtime / `maxDuration` / `POST` only).
Request pipeline: `chat-request.ts` (`handleChatRequest`).

| Module | Responsibility |
|--------|----------------|
| `chat-request.ts` | Full `/api/chat` POST pipeline (auth, system prompt, tools, review, stream) |
| `request.ts` | Body parse + light message validation |
| `messages.ts` | Sanitize, timestamps, tool-call extract, search heuristics |
| `credentials.ts` | Resolve requested integrations against authorized OAuth vault tokens |
| `system-prompt.ts` | Assemble the chat system-prompt parts (pure string assembly) |
| `product-guide.ts` | Detect product-usage questions that expand the in-app guide prompt |
| `tool-execution.ts` | Fallback query + failure-detection helpers around a single tool call |
| `upstream.ts` | OpenAI-compatible completions transport (stream + one-shot) |
| `stream-budget.ts` | Idle / total stream timeout math, plus `boundedAsyncIterator` that applies it to any upstream stream |
| `tool-round.ts` | One tool-calling round: stream + accumulate tool_call deltas alongside content/reasoning |
| `run-tool-rounds.ts` | Multi-round tool loop orchestrator (empty-`tool_calls` decisions + execute tools) |
| `final-completion.ts` | Post-tool-round completion streaming (content/reasoning split, stamp stripping) |
| `plain-completion.ts` | Un-budgeted tools-off completion streaming shared by Request Review answers and Auto-review corrections |
| `review-turns.ts` | Request Review orchestration: parse reviewed turns, run the claim audit per turn, build the dedicated-answer prompt |
| `thinking.ts` | Model thinking / CoT request policy |
| `errors.ts` | JSON error Response helper |

Claim Reviewer's own audit/verifier logic (local checks, LLM verifier,
mid-turn correction prompts) lives in `lib/tools/review/claim-reviewer`
(barrel) — the modules above only orchestrate *when* to call it from the
chat request pipeline.
