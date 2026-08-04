# lib/chat

Map of record for chat feature code. Split modules by **reusable function**, not line-count. Server-only helpers live under `server/` — see [`server/README.md`](./server/README.md); do not import them from client barrels.

## Placement / dependency direction

| Layer | Role |
|-------|------|
| `components/chat-container.tsx` | Wiring only — UI panels ↔ hooks; no new business logic |
| `hooks/chat/*` | React state, effects, and orchestration that needs the component tree |
| `lib/chat/*` | Pure / reusable logic (safe to call from hooks or server where not server-only) |
| `app/api/chat/route.ts` | Thin HTTP entry (`runtime` / `maxDuration` / `POST`) |
| `lib/chat/server/chat-request.ts` | Full `/api/chat` request pipeline |
| `lib/chat/server/*` | Server-only helpers used by that pipeline |

For the detailed ownership map (which hook/lib owns what), see the header comment in `components/chat-container.tsx`. Prefer extending the owning module over growing the container.

Public session-mutation path: `session/mutations/`. Always import from `@/lib/chat/session/mutations` (no other entry point).

| Folder | Responsibility |
|--------|----------------|
| `account/` | Account bind API, OAuth return query |
| `composer/` | Pure composer helpers: IME Enter-to-send guards (`ime.ts`); generated image/file download wrappers (`download.ts` → `@/lib/files/download`); product slash catalog (`slash-commands.ts` — SSOT for Composer + Sidebar command rows; icons in `components/chat/composer/slash-command-ui.ts`) |
| `integrations/` | Notion/GitHub/Google client status helpers |
| `session/` | Normalize/merge, persist; immutable SSE patches in `session/mutations/` (content, tool-runs, review, settle) |
| `stream/` | Client SSE consumer; shared `truncation.ts` (client + server); reply heuristics in `reply-truncation.ts` |
| `message/` | API message shaping, display, quotes, tags, timeline; shared open/close stream tag parser (`stream-xml-tags.ts`) used by `think-tags.ts` and `tool-tags.ts` |
| `turn/` | Client turn planning (hooks own React state + streaming): task queue, continue/claim-review, compact, slash *behavior* (`/image`, `/research`, `/papers`, `/books`, `/skill`, `/review` — always available; command *list* UI comes from `composer/slash-commands.ts`; opt-in Tools toggles only gate mid-reply tools), attachments, send estimate, stream errors |
| `context/` | References, time context, sidebar helpers |
| `server/` | `/api/chat` pipeline (`chat-request.ts`) + request helpers (server-only) |
| `types.ts` | Shared chat types |
