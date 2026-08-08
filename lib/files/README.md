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
| `gateway/` | Server Files API base URL, upload helpers, content parts for tools. |
| `scrub-deleted-file.ts` | Scrub deleted account file refs from sessions; collect exclusive file ids when deleting a conversation. |
| `url-preview.ts` | Side-panel online URL helpers (`isPreviewableHttpUrl`, normalize, `resolvePreviewHttpUrl` for extract/markdown hrefs + base, same-document nav equality, external-click detection, `isLikelyAuthGatedPreviewUrl` for hosts that need top-level browser login, `isLikelyPaperPreviewUrl` for DOI/publisher hosts that prefer OA PDF resolve over HTML extract). Extract Text links navigate in-panel via `onPreviewLink`; cross-origin iframe clicks stay uninterceptable. Paper Preview tries literature download → Files/`PdfReader`; thin/paywalled HTML shows a CTA instead of References-only extract. Webpage image OCR is out of scope for URL Preview. |
| `url-preview-embed.ts` | Blocked-embed probe + degrade when user switches to Embed (XFO/CSP heuristic; auto-back to Text when prefetch is ready). URL Preview defaults to Text for Quote. |
| `url-extract-clean.ts` | Conservative client cleaning for URL extract text (strip provider header blocks, `[Image N]` placeholders, Nature-style `about:` / hash citation links → footnote numbers; idempotent; server-side mirror lives in chat-api `services/tools/cleanContent.js`). Preview requests up to chat-api hard max (200k) with Load more via `startIndex` when truncated. |

Product-level attachment / vision / `file_read` flow: [`docs/images-and-files.md`](../../docs/images-and-files.md).

Assistant-delivered files (`book_download` / `create_file`) are serialized as `【历史文件引用】` markers (same family as collapsed user attachments) via `formatChatFileHistoryRefs` so follow-up turns can call `file_read`. After book download, `ensure-file-extract.ts` warms chat-api extract; `file_read` returns page slices via `extract-slice.ts`.

## Import rules

- New text/code extensions: add to `text-types.ts` only (do not reintroduce local `EXT_MIME` / `EXT_LANG` maps).
- Preview byte loads: `fetchFileContentForPreview` — do not ad-hoc `fetch(url)` in panels.
- Downloads: `@/lib/files/download` (or the thin chat wrappers that call it).
