# lib/files

Reusable file helpers shared by chat tools, preview UI, and downloads. Prefer extending these modules over copying MIME maps, fetch paths, or `<a download>` logic into call sites.

Repo-wide split rules: [`docs/code-organization.md`](../../docs/code-organization.md).

## Shared catalogs / helpers

| Module | Responsibility |
|--------|----------------|
| `text-types.ts` | **SSOT** for text/code extension → MIME + highlight language (`mimeFromFilename`, `languageFromFilename`, `isKnownTextFileExt`). Used by `create_file`, preview routing, and `FilePreviewOverlay`. |
| `paged-extract.ts` | **SSOT** for catalog/outline + `--- page N ---` extract serialization (`serializePagedExtract`, `buildCatalogPage`, ZIP bomb caps). Shared by DOCX / XLSX / PPTX / ZIP ingest. |
| `extract-slice.ts` | Parse `--- page N ---` blocks; `file_read` windowing + auto-skip TOC/catalog (`resolveAutoStartPage`). |
| `download.ts` | Browser download triggers (`triggerDownload`, `downloadBlob`, `downloadTextContent`). Chat composer wrappers live in `@/lib/chat/composer/download`. |
| `preview.ts` | Which files are previewable (text / image / PDF / EPUB / spreadsheet) and chrome labels — reads text extensions from `text-types`. |
| `direct-content.ts` | `fetchFileContentForPreview` — prefer browser → chat-api content GET; fall back to same-origin `/api/files` proxy. All in-product text/binary preview fetch should go through here. |
| `direct-upload.ts` | Upload ticket mint for browser → chat-api multipart. |
| `ingest/` | Thin client-side validation + image compression only. Bytes for docs (pdf/docx/epub/pptx/xlsx/zip) upload as opaque blobs; authoritative extract is produced by chat-api (see [`docs/plans/2026-08-07-008-feat-server-authority-anydoc-parsing-plan.md`](../../docs/plans/2026-08-07-008-feat-server-authority-anydoc-parsing-plan.md) U4a). Plain-text files are still read inline so the chat composer can render them. Drop whitelist: `ingest/support.ts`. |
| `gateway/` | Server Files API base URL, upload helpers, office mutate/restore (`mutate.ts`), content parts for tools. |
| `epub-progress.ts` | EPUB reading CFI + font prefs in localStorage (`load/save/clearEpubReaderPrefs`). |
| `preview-progress.ts` | Side Preview scroll positions (url / file / pdf / tool / sheet) in localStorage; `clearPreviewScrollForFileId` on account file delete. |
| `url-preview.ts` | Side-panel online URL helpers (`isPreviewableHttpUrl`, normalize, `resolvePreviewHttpUrl` for extract/markdown hrefs + base, same-document nav equality, external-click detection, `isLikelyAuthGatedPreviewUrl` for hosts that need top-level browser login, `isLikelyPaperPreviewUrl` for DOI/publisher hosts that prefer OA PDF resolve over HTML extract). Extract Text links navigate in-panel via `onPreviewLink`; cross-origin iframe clicks stay uninterceptable. Paper Preview resolves OA then opens an **ephemeral** same-origin content URL in `PdfReader` (does **not** write Files). Explicit `/papers download` (or Preview Download on an ephemeral paper) persists via `papers/download` with `source_key` dedupe. Thin/paywalled HTML shows a CTA instead of References-only extract. Webpage image OCR is out of scope for URL Preview. |
| `url-preview-embed.ts` | Blocked-embed probe + degrade when user switches to Embed (XFO/CSP heuristic; auto-back to Text when prefetch is ready). URL Preview defaults to Text for Quote. |
| `url-extract-clean.ts` | Conservative client cleaning for URL extract text (strip provider header blocks, `[Image N]` placeholders, Nature-style `about:` / hash citation links → footnote numbers; idempotent; server-side mirror lives in chat-api `services/tools/cleanContent.js`). Preview loads **chunked** extracts (~24k chars per request) with Load more via `startIndex` — never one-shot 200k. |

Product-level attachment / vision / `file_read` flow: [`docs/images-and-files.md`](../../docs/images-and-files.md).

Assistant-delivered files (`book_download` / `create_file`) are serialized as `【历史文件引用】` markers (same family as collapsed user attachments) via `formatChatFileHistoryRefs` so follow-up turns can call `file_read`. After book download, `ensure-file-extract.ts` warms chat-api extract; `file_read` returns page slices via `extract-slice.ts`.

Office write-back (`office_write` / `office_rollback`) mutates the same durable `fileId` on chat-api (snapshot + extract rebuild). Prefer that over re-uploading a new file when the user asked to edit an attachment. UI Undo calls `POST /api/files/:id/restore`.

## Import rules

- New text/code extensions: add to `text-types.ts` only (do not reintroduce local `EXT_MIME` / `EXT_LANG` maps).
- Preview byte loads: `fetchFileContentForPreview` — do not ad-hoc `fetch(url)` in panels.
- Downloads: `@/lib/files/download` (or the thin chat wrappers that call it).
