# lib/files

Reusable file helpers shared by chat tools, preview UI, and downloads. Prefer extending these modules over copying MIME maps, fetch paths, or `<a download>` logic into call sites.

Repo-wide split rules: [`docs/code-organization.md`](../../docs/code-organization.md).

## Shared catalogs / helpers

| Module | Responsibility |
|--------|----------------|
| `text-types.ts` | **SSOT** for text/code extension → MIME + highlight language (`mimeFromFilename`, `languageFromFilename`, `isKnownTextFileExt`). Used by `create_file`, preview routing, and `FilePreviewOverlay`. |
| `download.ts` | Browser download triggers (`triggerDownload`, `downloadBlob`, `downloadTextContent`). Chat composer wrappers live in `@/lib/chat/composer/download`. |
| `preview.ts` | Which files are previewable (text / image / PDF / EPUB / spreadsheet) and chrome labels — reads text extensions from `text-types`. |
| `direct-content.ts` | `fetchFileContentForPreview` — prefer browser → chat-api content GET; fall back to same-origin `/api/files` proxy. All in-product text/binary preview fetch should go through here. |
| `direct-upload.ts` | Upload ticket mint for browser → chat-api multipart. |
| `ingest/` | Client-side extract + prepare before upload (PDF/DOCX/Excel/text/images). |
| `gateway/` | Server Files API base URL, upload helpers, content parts for tools. |
| `attached-file-blocks.ts` | Fold older attachments into history reference blocks for the model. |

Product-level attachment / vision / `file_read` flow: [`docs/images-and-files.md`](../../docs/images-and-files.md).

## Import rules

- New text/code extensions: add to `text-types.ts` only (do not reintroduce local `EXT_MIME` / `EXT_LANG` maps).
- Preview byte loads: `fetchFileContentForPreview` — do not ad-hoc `fetch(url)` in panels.
- Downloads: `@/lib/files/download` (or the thin chat wrappers that call it).
