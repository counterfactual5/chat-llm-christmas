# anydoc-wasm pagination contract

When the server eventually runs the same document extraction inline (e.g. for
file_upload → sidecar generation), it MUST keep the `--- page N ---` paging
shape browser ingest introduced in `lib/files/ingest/anydoc.ts`. Both paths
write into the same attachment `text` field, and the model's context slicing
reads it via `parseExtractPages`.

## Contract

* **Page 1** is always the catalog page produced by `buildCatalogPage`.
  Entries are produced by `anydocCatalogEntries(filename)` from
  `lib/files/ingest/anydoc-paging.ts`. Never return a bare string body for
  anydoc-driven conversions — the catalog prefix is what tells the tool
  caller there is structured pagination to slice over.
* **Page 2** is the document body (single Markdown blob produced by
  `toMarkdownBytes`). We deliberately do NOT split anydoc output into
  synthetic sub-pages: the rust pipeline has no page-tagged blocks for
  several formats, so any client-side split would drift against the server.
* Errors that mean "fall back" (do not retry, do not throw):
  `unsupported`, `malformed`, `encrypted`, `resourceLimit`, `missingPart`
  — see `isAnydocFallbackError` in `anydoc-paging.ts`.

## Formats routed through anydoc on the client

| Kind | Routed? | Notes |
| ---- | ------- | ----- |
| docx | yes     | better tables/headings than mammoth |
| pdf  | yes     | better table fidelity than pdfjs/unpdf |
| epub | yes (future) | currently still the JS unpacker — flip when we measure epub quality |
| pptx | yes     | better tables & notes than the regex unpacker |
| xlsx, xlsm, ods, csv | **no** (client) | SheetJS keeps sheet/catalog structure; anydoc's flat markdown drops sheet names |
| doc, ppt, xls (OLE) | **no** | still rejected up-front with a "save as OOXML" hint |

`ANYDOC_ROUTED_KINDS` / `ANYDOC_SKIP_ON_CLIENT` in `anydoc-paging.ts` are the
source of truth. If the server pipes a format through anydoc that the client
does not (e.g. `.xlsx`), the server MUST rebuild a sheet catalog itself
before serializing, otherwise attachments ingest via API will look different
from the drag-drop path.

## Lazy loading

The wasm bundle (~6MB) is loaded via `await import('@firecrawl/anydoc-wasm')`
followed by a single `await init()`. Server code MUST pass the wasm bytes
explicitly via `initSync(fs.readFileSync(...))` — Next.js server traces will
not ship the `.wasm` otherwise.
