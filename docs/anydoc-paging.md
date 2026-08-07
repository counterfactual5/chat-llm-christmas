# anydoc-wasm pagination contract

This contract is now owned by **chat-api**. See
[`chat-api/docs/anydoc-paging.md`](../../chat-api/docs/anydoc-paging.md).

The browser no longer runs `@firecrawl/anydoc-wasm` — attachments are uploaded
as raw bytes and preview content is fetched from the server-side extract
sidecar (`GET /v1/files/:id/extract`).
