# lib/chat/server

Server-only helpers for `app/api/chat/route.ts`. Prefer importing these
directly from here; do not re-export through client chat barrels.

| Module | Responsibility |
|--------|----------------|
| `request.ts` | Body parse + light message validation |
| `messages.ts` | Sanitize, timestamps, tool-call extract, search heuristics |
| `upstream.ts` | OpenAI-compatible completions transport (stream + one-shot) |
| `stream-budget.ts` | Idle / total stream timeout math |
| `thinking.ts` | Model thinking / CoT request policy |
| `errors.ts` | JSON error Response helper |
