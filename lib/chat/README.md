# lib/chat

Map of record for chat feature code. Split modules by **reusable function**, not line-count. Server-only helpers live under `server/` — see [`server/README.md`](./server/README.md); do not import them from client barrels.

| Folder | Responsibility |
|--------|----------------|
| `account/` | Account bind API, OAuth return query |
| `composer/` | Pure composer helpers: IME Enter-to-send guards (`ime.ts`), generated image/file download (`download.ts`) |
| `integrations/` | Notion/GitHub/Google client status helpers |
| `session/` | Normalize/merge, persist; immutable SSE patches in `session/mutations/` (content, tool-runs, review, settle) |
| `stream/` | Client SSE consumer, reply truncation |
| `message/` | API message shaping, display, quotes, tags, timeline |
| `turn/` | Client turn planning (hooks own React state + streaming): task queue, continue/claim-review, compact, `/image`, attachments, send estimate, stream errors |
| `context/` | References, time context, sidebar helpers |
| `server/` | `/api/chat` request helpers (server-only) |
| `types.ts` | Shared chat types |
