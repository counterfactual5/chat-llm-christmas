# lib/chat

Feature folders:

| Folder | Responsibility |
|--------|----------------|
| `account/` | Account bind API, OAuth return query |
| `integrations/` | Notion/GitHub/Google client status helpers |
| `session/` | Normalize/merge, local+cloud persist, session mutations |
| `stream/` | Client SSE consumer, reply truncation |
| `message/` | API message shaping, display, quotes, tags, timeline |
| `turn/` | Task queue, continue/claim-review plan, compact, /image, attachments, send estimate, stream errors |
| `context/` | References, time context, sidebar helpers |
| `server/` | `/api/chat` request helpers (server-only) |
| `types.ts` | Shared chat types |
