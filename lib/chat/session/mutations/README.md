# lib/chat/session/mutations

Immutable session/message patches used by the client SSE consumer.

| Module | Responsibility |
|--------|----------------|
| `types.ts` | GeneratedFileInput / ToolRunInput / ToolRunUpsertResult |
| `shared.ts` | `touchSession` |
| `content.ts` | Content, reasoning, files, incomplete, review-fix stream |
| `tool-runs.ts` | Tool run upsert + settle open runs |
| `review.ts` | Review report/findings + serialize for claim review |
| `settle.ts` | Orphan reasoning, empty fallback, seeded cleanup |
| `index.ts` | Public barrel (`@/lib/chat/session/mutations`) |
